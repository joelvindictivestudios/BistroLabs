import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db/client";
import { parseRestaurantConfig } from "@/lib/email-concierge/types";
import { sendEmail } from "@/lib/messaging/send";

// GET /api/jobs/reminders — daglig cron (10:00, se vercel.json): påminnelse
// dagen före till bekräftade bokningar. Fönstret 18–42 h ≈ "startar i morgon"
// utan per-restaurang-datummatte; reminderSentAt gör jobbet idempotent.
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
      status: "CONFIRMED",
      reminderSentAt: null,
      startsAt: {
        gte: new Date(now + 18 * 3600_000),
        lte: new Date(now + 42 * 3600_000),
      },
      guest: { email: { not: null } },
    },
    include: {
      guest: { select: { name: true, email: true } },
      restaurant: { select: { name: true, config: true } },
      table: { select: { name: true } },
    },
    take: 200,
  });

  let sentCount = 0;
  for (const booking of bookings) {
    const email = booking.guest.email;
    if (!email) continue;
    const config = parseRestaurantConfig(booking.restaurant.config);
    const local = new Intl.DateTimeFormat("sv-SE", {
      timeZone: config.timezone,
      weekday: "long",
      hour: "2-digit",
      minute: "2-digit",
    }).format(booking.startsAt);
    const sent = await sendEmail({
      to: email,
      subject: `Påminnelse: bord i morgon — ${booking.restaurant.name}`,
      text:
        `Hej${booking.guest.name ? ` ${booking.guest.name}` : ""}!\n\n` +
        `En påminnelse om din bokning ${local} för ${booking.partySize} ` +
        `${booking.partySize === 1 ? "person" : "personer"}` +
        `${booking.table ? ` (bord ${booking.table.name})` : ""}.\n\n` +
        `Kan du inte komma? Hör av dig till oss så snart som möjligt.\n\n` +
        `Välkommen!\n${booking.restaurant.name}`,
    });
    if (sent.ok) {
      await prisma.booking.update({
        where: { id: booking.id },
        data: { reminderSentAt: new Date() },
      });
      sentCount++;
    }
  }

  return NextResponse.json({ scanned: bookings.length, sent: sentCount });
}
