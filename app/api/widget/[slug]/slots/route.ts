import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db/client";
import { parseRestaurantConfig } from "@/lib/email-concierge/types";
import {
  listAvailableSlots,
  slotCandidates,
} from "@/lib/booking/availability";
import { guestBookingBlocked } from "@/lib/booking/rules";
import { verifyManageToken } from "@/lib/booking/manage-token";

// GET /api/widget/demo/slots?date=2026-07-10&party=2
//   → { slots: ["17:00", ...], fullSlots: ["18:30", ...] }
// fullSlots = tider inom öppettiderna som föll bort pga beläggning —
// widgeten grånar dem och visar väntelistans CTA (§3.8).
//
// ?manage=<token>: anropet kommer från hanteringssidans ombokning — gästens
// egen bokning exkluderas ur beläggningen (annars blockerar den sin egen
// flytt) och bokningsstopp/same-day-cutoff tillämpas inte (gäller bara NYA
// gästbokningar, inte ändring av befintlig).
export async function GET(
  request: NextRequest,
  ctx: RouteContext<"/api/widget/[slug]/slots">,
) {
  const { slug } = await ctx.params;
  const date = request.nextUrl.searchParams.get("date") ?? "";
  const party = Number(request.nextUrl.searchParams.get("party"));
  const manageToken = request.nextUrl.searchParams.get("manage");

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

  // Token istället för rått boknings-id så publika anropare inte kan vidga
  // tillgängligheten godtyckligt
  let excludeBookingId: string | undefined;
  const verified = manageToken ? verifyManageToken(manageToken) : null;
  if (verified?.ok) excludeBookingId = verified.bookingId;

  // Gästspärrar: bokningsstopp-datum + same-day-cutoff (röda dagar ger tomt
  // redan i listAvailableSlots). Gäller inte hanteringssidans ombokning.
  if (!excludeBookingId) {
    const blockedReason = guestBookingBlocked(config, date);
    if (blockedReason) {
      return NextResponse.json({ slots: [], fullSlots: [], blockedReason });
    }
  }

  const slots = await listAvailableSlots(
    restaurant.id,
    config,
    date,
    party,
    30,
    excludeBookingId ? { excludeBookingId } : undefined,
  );
  const available = new Set(slots);
  const fullSlots = slotCandidates(config, date).filter(
    (t) => !available.has(t),
  );
  return NextResponse.json({ slots, fullSlots });
}
