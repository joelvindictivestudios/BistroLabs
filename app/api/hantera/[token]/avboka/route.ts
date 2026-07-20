import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db/client";
import { parseRestaurantConfig } from "@/lib/email-concierge/types";
import { verifyManageToken, buildManageUrl } from "@/lib/booking/manage-token";
import { insideCancellationWindow } from "@/lib/booking/policy";
import { releaseCard } from "@/lib/payments/psp";
import { notifyGuest } from "@/lib/messaging/notify";
import {
  avbokningsbekraftelseMail,
  formatBookingWhen,
} from "@/lib/messaging/templates";
import { appBaseUrl } from "@/lib/urls";

// POST /api/hantera/[token]/avboka — gästens kostnadsfria avbokning (§3.6).
// Endast utanför avbokningsfönstret; kortgarantin släpps DIREKT (§3.6).
export async function POST(
  request: NextRequest,
  ctx: RouteContext<"/api/hantera/[token]/avboka">,
) {
  const { token } = await ctx.params;
  const verified = verifyManageToken(token);
  if (!verified.ok) {
    return verified.reason === "utgangen"
      ? NextResponse.json(
          { error: "Länken har gått ut — kontakta restaurangen." },
          { status: 410 },
        )
      : NextResponse.json({ error: "Ogiltig länk." }, { status: 401 });
  }

  const booking = await prisma.booking.findUnique({
    where: { id: verified.bookingId },
    include: { guest: true, restaurant: true },
  });
  if (!booking) {
    return NextResponse.json({ error: "Bokningen finns inte." }, { status: 410 });
  }
  if (booking.status === "CANCELLED") {
    return NextResponse.json({ ok: true, alreadyCancelled: true });
  }
  if (booking.status !== "PENDING" && booking.status !== "CONFIRMED") {
    return NextResponse.json(
      { error: "Bokningen kan inte längre avbokas via länken." },
      { status: 410 },
    );
  }

  const config = parseRestaurantConfig(booking.restaurant.config);
  if (insideCancellationWindow(booking.startsAt, config)) {
    return NextResponse.json(
      {
        error: `Så nära ankomst kan avbokning inte göras online — ring oss så hjälper vi dig.`,
        phone:
          config.voiceAgent.transferNumber ||
          config.voiceAgent.phoneNumber ||
          null,
      },
      { status: 403 },
    );
  }

  // Race-säkert mot samtidiga statusändringar (personal/cron)
  const res = await prisma.booking.updateMany({
    where: { id: booking.id, status: { in: ["PENDING", "CONFIRMED"] } },
    data: {
      status: "CANCELLED",
      cancelInfo: {
        av: "gäst",
        tidpunkt: new Date().toISOString(),
      },
      // Kortgarantin släpps direkt vid gästavbokning (§3.6)
      cardPspToken: null,
      cardLast4: null,
    },
  });
  if (res.count === 0) {
    return NextResponse.json(
      { error: "Bokningen hann ändras — ladda om sidan." },
      { status: 410 },
    );
  }
  if (booking.cardPspToken) {
    await releaseCard(booking.cardPspToken); // best-effort, kastar aldrig
  }

  const policy = {
    cancellationWindowHours: config.cancellationWindowHours,
    noShowFeePerGuest: config.noShowFeePerGuest,
    cardGuaranteeRequired: config.cardGuaranteeRequired,
  };
  await notifyGuest({
    bookingId: booking.id,
    guest: booking.guest,
    type: "CANCELLATION_CONFIRMATION",
    email: avbokningsbekraftelseMail({
      restaurantName: booking.restaurant.name,
      guestName: booking.guest.name,
      whenText: formatBookingWhen(booking.startsAt, config.timezone),
      partySize: booking.partySize,
      manageUrl: buildManageUrl(
        appBaseUrl(request.nextUrl.origin),
        booking.id,
        booking.endsAt,
      ),
      policy,
    }),
  });

  return NextResponse.json({ ok: true });
}
