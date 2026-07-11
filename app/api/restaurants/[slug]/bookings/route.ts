import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/client";
import { getUser } from "@/lib/auth/server";
import { parseRestaurantConfig } from "@/lib/email-concierge/types";
import {
  createBooking,
  checkAvailability,
  isOverlapViolation,
  localToUtc,
} from "@/lib/booking/availability";

const dropInSchema = z
  .object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    time: z.string().regex(/^\d{2}:\d{2}$/),
    partySize: z.number().int().min(1).max(50),
    childrenCount: z.number().int().min(0).default(0),
    tableId: z.uuid().optional(), // annars auto-tilldelning
    guestId: z.uuid().optional(), // annars placeholder-gäst
    onSite: z.boolean().default(false), // gästen står här → SEATED direkt
    notes: z.string().max(500).optional(),
  })
  .refine((d) => d.childrenCount <= d.partySize, {
    message: "Antal barn kan inte överstiga sällskapets storlek",
  });

// POST /api/restaurants/{slug}/bookings — personalens drop-in/inringda
// bokningar. Bypassar gästspärrarna (bokningsstopp + same-day-cutoff) men
// INTE röda dagar (restaurangen är stängd) eller dubbelbokningsskyddet.
export async function POST(
  request: NextRequest,
  ctx: RouteContext<"/api/restaurants/[slug]/bookings">,
) {
  const user = await getUser();
  if (!user) {
    return NextResponse.json({ error: "Inte inloggad." }, { status: 401 });
  }
  const { slug } = await ctx.params;
  const restaurant = await prisma.restaurant.findUnique({ where: { slug } });
  if (!restaurant) {
    return NextResponse.json({ error: "Okänd restaurang." }, { status: 404 });
  }
  if (restaurant.ownerId !== user.id) {
    return NextResponse.json(
      { error: "Du äger inte den här restaurangen." },
      { status: 403 },
    );
  }

  const parsed = dropInSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Ogiltiga uppgifter" },
      { status: 400 },
    );
  }
  const body = parsed.data;
  const config = parseRestaurantConfig(restaurant.config);

  if (config.closedDates.includes(body.date)) {
    return NextResponse.json(
      { error: `${body.date} är en röd dag — restaurangen är stängd.` },
      { status: 409 },
    );
  }

  // Gäst: angiven kund eller placeholder som kopplas i efterhand
  let guestId = body.guestId ?? null;
  if (guestId) {
    const guest = await prisma.guest.findFirst({
      where: { id: guestId, restaurantId: restaurant.id },
    });
    if (!guest) {
      return NextResponse.json({ error: "Okänd kund." }, { status: 404 });
    }
  } else {
    const placeholder = await prisma.guest.create({
      data: { restaurantId: restaurant.id, name: "Drop-in" },
    });
    guestId = placeholder.id;
  }

  const status = body.onSite ? ("SEATED" as const) : ("CONFIRMED" as const);
  const seatedAt = body.onSite ? new Date() : null;

  // Valt bord: validera kapacitet och skriv direkt (constrainten vaktar
  // överlapp). Inget bord valt: greedy auto-tilldelning.
  if (body.tableId) {
    const table = await prisma.diningTable.findFirst({
      where: { id: body.tableId, restaurantId: restaurant.id },
    });
    if (!table) {
      return NextResponse.json({ error: "Okänt bord." }, { status: 404 });
    }
    if (table.capacity < body.partySize) {
      return NextResponse.json(
        {
          error: `${table.name} rymmer bara ${table.capacity} — sällskapet är ${body.partySize}.`,
        },
        { status: 400 },
      );
    }
    const startsAt = localToUtc(body.date, body.time, config.timezone);
    const endsAt = new Date(
      startsAt.getTime() + config.bookingDurationMinutes * 60_000,
    );
    try {
      const booking = await prisma.booking.create({
        data: {
          restaurantId: restaurant.id,
          guestId,
          tableId: table.id,
          startsAt,
          endsAt,
          partySize: body.partySize,
          childrenCount: body.childrenCount,
          notes: body.notes,
          status,
          seatedAt,
          createdBy: "dropin",
        },
      });
      return NextResponse.json(
        { bookingId: booking.id, tableName: table.name },
        { status: 201 },
      );
    } catch (e) {
      if (isOverlapViolation(e)) {
        return NextResponse.json(
          { error: `${table.name} är upptaget den tiden — välj ett annat bord.` },
          { status: 409 },
        );
      }
      throw e;
    }
  }

  // Auto-tilldelning (respekterar öppettider + minSeats som gästflödet)
  const availability = await checkAvailability(
    restaurant.id,
    config,
    body.date,
    body.time,
    body.partySize,
  );
  if (!availability.available) {
    return NextResponse.json({ error: availability.reason }, { status: 409 });
  }
  const result = await createBooking(
    restaurant.id,
    config,
    guestId,
    body.date,
    body.time,
    body.partySize,
    body.notes,
    { status: "CONFIRMED", createdBy: "dropin" },
  );
  if (!result.ok) {
    return NextResponse.json({ error: result.reason }, { status: 409 });
  }
  if (body.onSite || body.childrenCount > 0) {
    await prisma.booking.update({
      where: { id: result.bookingId },
      data: {
        childrenCount: body.childrenCount,
        ...(body.onSite ? { status: "SEATED", seatedAt: new Date() } : {}),
      },
    });
  }
  return NextResponse.json(
    { bookingId: result.bookingId, tableName: result.tableName },
    { status: 201 },
  );
}
