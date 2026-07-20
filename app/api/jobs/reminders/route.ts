import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db/client";
import { parseRestaurantConfig } from "@/lib/email-concierge/types";
import {
  cancellationDeadline,
  formatDeadlineTime,
} from "@/lib/booking/policy";
import { buildManageUrl } from "@/lib/booking/manage-token";
import { appBaseUrl } from "@/lib/urls";
import { notifyGuest } from "@/lib/messaging/notify";
import {
  paminnelseMail,
  paminnelseSms,
  kortPaminnelseMail,
  kortlankSms,
  formatBookingWhen,
} from "@/lib/messaging/templates";

// GET /api/jobs/reminders — daglig cron (10:00, se vercel.json): påminnelse
// dagen före. Bekräftade får vanliga påminnelsen (mall 3, §3.7); preliminära
// får kortpåminnelse-varianten (§2 p.4) med deadline. Båda bär
// hanteringslänken. Fönstret 18–42 h ≈ "startar i morgon" utan
// per-restaurang-datummatte; reminderSentAt gör jobbet idempotent.
// Systemroute: skyddas av CRON_SECRET, ingen användarsession.
export async function GET(request: NextRequest) {
  if (
    request.headers.get("authorization") !==
    `Bearer ${process.env.CRON_SECRET}`
  ) {
    return NextResponse.json({ error: "Obehörig." }, { status: 401 });
  }

  const now = Date.now();
  const bookings = await prisma.booking.findMany({
    where: {
      status: { in: ["CONFIRMED", "PENDING"] },
      reminderSentAt: null,
      startsAt: {
        gte: new Date(now + 18 * 3600_000),
        lte: new Date(now + 42 * 3600_000),
      },
      guest: { email: { not: null } },
    },
    include: {
      guest: { select: { name: true, email: true, phone: true } },
      restaurant: { select: { name: true, config: true } },
      table: { select: { name: true } },
    },
    take: 200,
  });

  let sentCount = 0;
  for (const booking of bookings) {
    if (!booking.guest.email) continue;
    const config = parseRestaurantConfig(booking.restaurant.config);
    const data = {
      restaurantName: booking.restaurant.name,
      guestName: booking.guest.name,
      whenText: formatBookingWhen(booking.startsAt, config.timezone),
      partySize: booking.partySize,
      tableName: booking.table?.name ?? null,
      manageUrl: buildManageUrl(
        appBaseUrl(request.nextUrl.origin),
        booking.id,
        booking.endsAt,
      ),
      policy: {
        cancellationWindowHours: config.cancellationWindowHours,
        noShowFeePerGuest: config.noShowFeePerGuest,
        cardGuaranteeRequired: config.cardGuaranteeRequired,
      },
    };

    const deadlineText = `kl ${formatDeadlineTime(
      cancellationDeadline(booking.startsAt, config),
      config.timezone,
    )}`;
    const mail =
      booking.status === "PENDING"
        ? kortPaminnelseMail({ ...data, deadlineText })
        : paminnelseMail({
            ...data,
            timeText: new Intl.DateTimeFormat("sv-SE", {
              timeZone: config.timezone,
              hour: "2-digit",
              minute: "2-digit",
            }).format(booking.startsAt),
          });

    const { emailOk } = await notifyGuest({
      bookingId: booking.id,
      guest: booking.guest,
      type: "REMINDER",
      email: mail,
      sms:
        booking.status === "PENDING"
          ? kortlankSms({ ...data, deadlineText })
          : paminnelseSms(data),
      smsFrom: config.voiceAgent.phoneNumber || undefined,
    });
    if (emailOk) {
      await prisma.booking.update({
        where: { id: booking.id },
        data: { reminderSentAt: new Date() },
      });
      sentCount++;
    }
  }

  return NextResponse.json({ scanned: bookings.length, sent: sentCount });
}
