import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db/client";
import { parseRestaurantConfig } from "@/lib/email-concierge/types";
import { listAvailableSlots } from "@/lib/booking/availability";
import { guestBookingBlocked } from "@/lib/booking/rules";

// GET /api/widget/demo/slots?date=2026-07-10&party=2 → { slots: ["17:00", ...] }
export async function GET(
  request: NextRequest,
  ctx: RouteContext<"/api/widget/[slug]/slots">,
) {
  const { slug } = await ctx.params;
  const date = request.nextUrl.searchParams.get("date") ?? "";
  const party = Number(request.nextUrl.searchParams.get("party"));

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isInteger(party) || party < 1) {
    return NextResponse.json(
      { error: "Ange date=YYYY-MM-DD och party som heltal ≥ 1" },
      { status: 400 },
    );
  }

  const restaurant = await prisma.restaurant.findUnique({ where: { slug } });
  if (!restaurant) {
    return NextResponse.json({ error: "Okänd restaurang" }, { status: 404 });
  }
  const config = parseRestaurantConfig(restaurant.config);

  // Gästspärrar: bokningsstopp-datum + same-day-cutoff (röda dagar ger tomt
  // redan i listAvailableSlots)
  const blockedReason = guestBookingBlocked(config, date);
  if (blockedReason) {
    return NextResponse.json({ slots: [], blockedReason });
  }

  const slots = await listAvailableSlots(restaurant.id, config, date, party);
  return NextResponse.json({ slots });
}
