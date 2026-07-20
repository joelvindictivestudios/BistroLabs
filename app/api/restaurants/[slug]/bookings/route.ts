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
import { findOrCreateGuest } from "@/lib/booking/guests";
import { logCommunication } from "@/lib/messaging/notify";
import { sendCardLink } from "@/lib/messaging/card-link";

const dropInSchema = z
  .object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    time: z.string().regex(/^\d{2}:\d{2}$/),
    partySize: z.number().int().min(1).max(50),
    childrenCount: z.number().int().min(0).default(0),
    tableId: z.uuid().optional(), // annars auto-tilldelning
    guestId: z.uuid().optional(), // annars placeholder-gäst
    /** Ny gäst inline ("Ny bokning"-modalen) — dedupe:as på telefon/e-post */
    guest: z
      .object({
        name: z.string().min(1).max(120),
        phone: z.string().min(5).max(30).optional(),
        email: z.email().optional(),
      })
      .optional(),
    onSite: z.boolean().default(false), // gästen står här → SEATED direkt
    notes: z.string().max(500).optional(),
    /**
     * Preliminär (§3.2): gästen mejlas kortlänken och bokningen bekräftas
     * automatiskt när kortet registrerats. Default CONFIRMED behåller
     * bakåtkompat med walk-in-anrop.
     */
    status: z.enum(["PENDING", "CONFIRMED"]).default("CONFIRMED"),
  })
  .refine((d) => d.childrenCount <= d.partySize, {
    message: "Antal barn kan inte överstiga sällskapets storlek",
  })
  .refine((d) => !(d.guestId && d.guest), {
    message: "Ange antingen guestId eller guest — inte båda.",
  })
  .refine((d) => !(d.onSite && d.status === "PENDING"), {
    message: "En gäst på plats kan inte vara preliminär.",
  })
  .refine((d) => d.status !== "PENDING" || d.guestId || d.guest?.email, {
    message: "Ange gästens e-post — kortlänken mejlas dit.",
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

  // Gäst: angiven kund, ny gäst inline, eller placeholder som kopplas i efterhand
  let guestId = body.guestId ?? null;
  if (guestId) {
    const guest = await prisma.guest.findFirst({
      where: { id: guestId, restaurantId: restaurant.id },
    });
    if (!guest) {
      return NextResponse.json({ error: "Okänd kund." }, { status: 404 });
    }
    if (body.status === "PENDING" && !guest.email) {
      return NextResponse.json(
        { error: "Gästen saknar e-post — kortlänken kan inte mejlas." },
        { status: 400 },
      );
    }
  } else if (body.guest) {
    if (body.guest.phone || body.guest.email) {
      const { guest } = await findOrCreateGuest(restaurant.id, body.guest);
      guestId = guest.id;
    } else {
      // Endast namn — ingen kontaktväg att dedupe:a på, skapa namngiven gäst
      const named = await prisma.guest.create({
        data: { restaurantId: restaurant.id, name: body.guest.name },
      });
      guestId = named.id;
    }
  } else {
    const placeholder = await prisma.guest.create({
      data: { restaurantId: restaurant.id, name: "Drop-in" },
    });
    guestId = placeholder.id;
  }

  const status = body.onSite ? ("SEATED" as const) : body.status;
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
      await afterStaffCreate(booking.id, status, request.nextUrl.origin);
      return NextResponse.json(
        { bookingId: booking.id, tableName: table.name, status },
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
    // onSite → SEATED sätts i efterpatchen nedan (createBooking tar bara PENDING/CONFIRMED)
    { status: status === "SEATED" ? "CONFIRMED" : status, createdBy: "dropin" },
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
  await afterStaffCreate(result.bookingId, status, request.nextUrl.origin);
  return NextResponse.json(
    { bookingId: result.bookingId, tableName: result.tableName, status },
    { status: 201 },
  );
}

// Kommunikationslogg + kortlänksutskick för nyskapade personalbokningar.
// RECEIVED loggas för alla; preliminära får kortlänken mejlad (§3.2).
async function afterStaffCreate(
  bookingId: string,
  status: "PENDING" | "CONFIRMED" | "SEATED",
  origin: string,
) {
  await logCommunication(bookingId, "RECEIVED", null, { kalla: "personal" });
  if (status === "PENDING") {
    const sent = await sendCardLink(bookingId, origin);
    if (!sent.ok) {
      console.error(`Kortlänken gick inte att skicka: ${sent.error}`);
    }
  }
}
