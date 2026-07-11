import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/client";
import { getUser } from "@/lib/auth/server";
import { isOverlapViolation } from "@/lib/booking/availability";

const patchSchema = z
  .object({
    tableId: z.uuid().optional(),
    status: z
      .enum(["CONFIRMED", "SEATED", "COMPLETED", "NO_SHOW", "CANCELLED"])
      .optional(),
    guestId: z.uuid().optional(), // koppla drop-in till en riktig kund
  })
  .refine(
    (d) =>
      d.tableId !== undefined ||
      d.status !== undefined ||
      d.guestId !== undefined,
    { message: "Ange tableId, status och/eller guestId" },
  );

// PATCH /api/restaurants/{slug}/bookings/{id} — personalens verktyg i dagvyn:
// flytta bokning till annat bord (drag & drop) och/eller ändra status
// (check-in, avsluta, släpp bordet, avboka).
export async function PATCH(
  request: NextRequest,
  ctx: RouteContext<"/api/restaurants/[slug]/bookings/[id]">,
) {
  const user = await getUser();
  if (!user) {
    return NextResponse.json({ error: "Inte inloggad." }, { status: 401 });
  }
  const { slug, id } = await ctx.params;
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

  const booking = await prisma.booking.findFirst({
    where: { id, restaurantId: restaurant.id },
  });
  if (!booking) {
    return NextResponse.json({ error: "Okänd bokning." }, { status: 404 });
  }

  const parsed = patchSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Ogiltig ändring." },
      { status: 400 },
    );
  }
  const { tableId, status, guestId } = parsed.data;

  if (guestId !== undefined) {
    const guest = await prisma.guest.findFirst({
      where: { id: guestId, restaurantId: restaurant.id },
    });
    if (!guest) {
      return NextResponse.json({ error: "Okänd kund." }, { status: 404 });
    }
  }

  // Flytt: kapacitet är ett hårt krav (fysiskt), minSeats ignoreras — personalen
  // vet bäst när de möblerar om. Tidskrockar stoppas av bookings_no_overlap.
  if (tableId !== undefined) {
    const table = await prisma.diningTable.findFirst({
      where: { id: tableId, restaurantId: restaurant.id },
    });
    if (!table) {
      return NextResponse.json({ error: "Okänt bord." }, { status: 404 });
    }
    if (table.capacity < booking.partySize) {
      return NextResponse.json(
        {
          error: `${table.name} rymmer bara ${table.capacity} — sällskapet är ${booking.partySize}.`,
        },
        { status: 400 },
      );
    }
  }

  try {
    const updated = await prisma.booking.update({
      where: { id: booking.id },
      data: {
        ...(tableId !== undefined ? { tableId } : {}),
        ...(status !== undefined ? { status } : {}),
        ...(guestId !== undefined ? { guestId } : {}),
        // Incheckningstid stämplas när gästen anländer — driver Sitter-timern
        ...(status === "SEATED" ? { seatedAt: new Date() } : {}),
      },
      include: { table: { select: { name: true } } },
    });
    return NextResponse.json({
      id: updated.id,
      tableId: updated.tableId,
      tableName: updated.table?.name ?? null,
      status: updated.status,
    });
  } catch (e) {
    if (isOverlapViolation(e)) {
      return NextResponse.json(
        { error: "Bordet är upptaget den tiden — välj ett annat bord." },
        { status: 409 },
      );
    }
    throw e;
  }
}
