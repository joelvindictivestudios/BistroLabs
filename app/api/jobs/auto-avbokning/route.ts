import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db/client";
import {
  parseRestaurantConfig,
  type RestaurantConfig,
} from "@/lib/email-concierge/types";
import { cancellationDeadline } from "@/lib/booking/policy";
import { notifyGuest } from "@/lib/messaging/notify";
import {
  autoAvbokningMail,
  formatBookingWhen,
} from "@/lib/messaging/templates";
import { appBaseUrl } from "@/lib/urls";

// Auto-avbokning av preliminära bokningar utan kort (§2 p.4): körs var 15:e
// minut (vercel.json — kräver Vercel Pro; på Hobby behövs extern pinger).
// Deadline = starttid − cancellationWindowHours, beräknad VID KÖRNING per
// restaurangens config — lagras aldrig (§2b p.3).
//
// Omfattar även AI-inkorgens PENDING-bokningar (specbekräftat: PENDING-
// semantiken är "väntar på kortbekräftelse") — därför är mejlcopyn neutral
// ("inte bekräftad i tid"), inte kortspecifik.
//
// Idempotens/race: villkorad updateMany på status PENDING + kort saknas —
// kortregistreringen (som också skriver villkorat) och cronen kan inte båda
// vinna. SQL-förfiltret startsAt <= now+72h är säkert eftersom zod cappar
// cancellationWindowHours till max 72. Skanningen serveras av partialindexet
// bookings_pending_cardless_idx.

const GRACE_MINUTES = 60;

export async function GET(request: NextRequest) {
  if (
    request.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`
  ) {
    return NextResponse.json({ error: "Obehörig." }, { status: 401 });
  }

  const now = new Date();
  const candidates = await prisma.booking.findMany({
    where: {
      status: "PENDING",
      cardPspToken: null,
      startsAt: { lte: new Date(now.getTime() + 72 * 3600_000) },
    },
    include: {
      guest: { select: { name: true, email: true, phone: true } },
      restaurant: { select: { id: true, slug: true, name: true, config: true } },
    },
    orderBy: { startsAt: "asc" },
    take: 500,
  });

  const configCache = new Map<string, RestaurantConfig>();
  const configFor = (r: { id: string; config: unknown }): RestaurantConfig => {
    const cached = configCache.get(r.id);
    if (cached) return cached;
    const parsed = parseRestaurantConfig(r.config);
    configCache.set(r.id, parsed);
    return parsed;
  };

  let cancelled = 0;
  for (const b of candidates) {
    const config = configFor(b.restaurant);
    const deadline = cancellationDeadline(b.startsAt, config);
    if (now < deadline) continue;
    // Nåderegel: en preliminär skapad INUTI fönstret (deadline redan passerad
    // vid skapandet) får alltid minst en timme innan den auto-avbokas —
    // annars försvinner den på nästa cron-tick innan gästen öppnat mejlet.
    if (
      b.createdAt > deadline &&
      b.createdAt.getTime() + GRACE_MINUTES * 60_000 > now.getTime()
    ) {
      continue;
    }

    const res = await prisma.booking.updateMany({
      where: { id: b.id, status: "PENDING", cardPspToken: null },
      data: {
        status: "CANCELLED",
        cancelInfo: {
          av: "auto",
          orsak: "Ej bekräftad före deadline",
          tidpunkt: now.toISOString(),
        },
      },
    });
    if (res.count === 0) continue; // gästen hann registrera kort

    cancelled++;
    await notifyGuest({
      bookingId: b.id,
      guest: b.guest,
      type: "AUTO_CANCELLATION",
      email: autoAvbokningMail({
        restaurantName: b.restaurant.name,
        guestName: b.guest.name,
        whenText: formatBookingWhen(b.startsAt, config.timezone),
        partySize: b.partySize,
        manageUrl: "", // används inte i mallen
        rebookUrl: `${appBaseUrl(request.nextUrl.origin)}/widget/${b.restaurant.slug}`,
        policy: {
          cancellationWindowHours: config.cancellationWindowHours,
          noShowFeePerGuest: config.noShowFeePerGuest,
          cardGuaranteeRequired: config.cardGuaranteeRequired,
        },
      }),
    });
  }

  return NextResponse.json({ scanned: candidates.length, cancelled });
}
