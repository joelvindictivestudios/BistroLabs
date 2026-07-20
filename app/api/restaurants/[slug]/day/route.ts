import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db/client";
import { getUser } from "@/lib/auth/server";
import { parseRestaurantConfig } from "@/lib/email-concierge/types";
import { localToUtc } from "@/lib/booking/availability";

// GET /api/restaurants/{slug}/day?date=YYYY-MM-DD — dagvyns data:
// rum, bord och dagens bokningar. Anropas vid load och som refetch när
// Supabase Realtime signalerar en ändring i bookings.
export async function GET(
  request: NextRequest,
  ctx: RouteContext<"/api/restaurants/[slug]/day">,
) {
  const user = await getUser();
  if (!user) {
    return NextResponse.json({ error: "Inte inloggad." }, { status: 401 });
  }
  const { slug } = await ctx.params;
  const restaurant = await prisma.restaurant.findUnique({
    where: { slug },
    include: {
      rooms: { orderBy: { sortOrder: "asc" } },
      tables: { orderBy: { name: "asc" } },
    },
  });
  if (!restaurant) {
    return NextResponse.json({ error: "Okänd restaurang." }, { status: 404 });
  }
  if (restaurant.ownerId !== user.id) {
    return NextResponse.json(
      { error: "Du äger inte den här restaurangen." },
      { status: 403 },
    );
  }

  const date = request.nextUrl.searchParams.get("date") ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: "Ange date=YYYY-MM-DD" }, { status: 400 });
  }

  const config = parseRestaurantConfig(restaurant.config);
  const dayStart = localToUtc(date, "00:00", config.timezone);
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

  const bookings = await prisma.booking.findMany({
    where: {
      restaurantId: restaurant.id,
      startsAt: { gte: dayStart, lt: dayEnd },
    },
    orderBy: { startsAt: "asc" },
    include: {
      guest: { select: { name: true, email: true, phone: true } },
      commLogs: { orderBy: { sentAt: "asc" } },
    },
  });

  return NextResponse.json({
    restaurantId: restaurant.id,
    rooms: restaurant.rooms.map((r) => ({ id: r.id, name: r.name })),
    tables: restaurant.tables.map((t) => ({
      id: t.id,
      roomId: t.roomId,
      name: t.name,
      capacity: t.capacity,
      minSeats: t.minSeats,
      shape: t.shape,
      posX: t.posX,
      posY: t.posY,
    })),
    bookings: bookings.map((b) => ({
      id: b.id,
      tableId: b.tableId,
      guestId: b.guestId,
      startsAt: b.startsAt.toISOString(),
      endsAt: b.endsAt.toISOString(),
      partySize: b.partySize,
      childrenCount: b.childrenCount,
      status: b.status,
      seatedAt: b.seatedAt?.toISOString() ?? null,
      createdAt: b.createdAt.toISOString(),
      createdBy: b.createdBy,
      notes: b.notes,
      arrivedCount: b.arrivedCount,
      staffNote: b.staffNote,
      allergyNote: b.allergyNote,
      guestName: b.guest.name ?? b.guest.email ?? b.guest.phone ?? "Gäst",
      guestEmail: b.guest.email,
      guestPhone: b.guest.phone,
      cardLast4: b.cardLast4,
      charged: b.charged === null ? null : Number(b.charged),
      cancelInfo: b.cancelInfo,
      commLog: b.commLogs.map((c) => ({
        id: c.id,
        type: c.type,
        channel: c.channel,
        at: c.sentAt.toISOString(),
        meta: c.meta,
      })),
    })),
  });
}
