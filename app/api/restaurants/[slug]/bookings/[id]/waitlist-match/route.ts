import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db/client";
import { getUser } from "@/lib/auth/server";
import { parseRestaurantConfig } from "@/lib/email-concierge/types";

// GET .../bookings/{id}/waitlist-match — matchning för avbokningsdialogen
// (§3.5): äldsta VÄNTANDE köplats med samma lokala dag, sällskap som ryms
// (partySize ≤ bokningens) och bokningens starttid inom önskeintervallet.
// Zero-paddade HH:MM-strängar gör intervallkollen till ren strängjämförelse.
export async function GET(
  request: NextRequest,
  ctx: RouteContext<"/api/restaurants/[slug]/bookings/[id]/waitlist-match">,
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

  const config = parseRestaurantConfig(restaurant.config);
  const localDate = new Intl.DateTimeFormat("sv-SE", {
    timeZone: config.timezone,
  }).format(booking.startsAt);
  const localTime = new Intl.DateTimeFormat("sv-SE", {
    timeZone: config.timezone,
    hour: "2-digit",
    minute: "2-digit",
  }).format(booking.startsAt);

  const match = await prisma.waitlistEntry.findFirst({
    where: {
      restaurantId: restaurant.id,
      status: "WAITING",
      date: localDate,
      partySize: { lte: booking.partySize },
      wishedFrom: { lte: localTime },
      wishedTo: { gte: localTime },
    },
    orderBy: { createdAt: "asc" },
  });

  return NextResponse.json({
    match: match
      ? {
          id: match.id,
          name: match.name,
          phone: match.phone,
          partySize: match.partySize,
          date: match.date,
          wishedFrom: match.wishedFrom,
          wishedTo: match.wishedTo,
          status: match.status,
          offeredTime: match.offeredTime,
        }
      : null,
  });
}
