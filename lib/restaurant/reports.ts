import { prisma } from "@/lib/db/client";
import type { RestaurantConfig } from "@/lib/email-concierge/types";

// Rapporterna (§3.13): no-show-andel 30 dgr med före/efter kortgarantin,
// debiterade avgifter, avbokningar varav auto, beläggning — plus graferna
// no-shows per vecka (8 v, garantiveckan markerad) och beläggning per
// veckodag. Raka Prisma-frågor + JS-aggregat; referenspunkten är
// config.cardGuaranteeSince med äldsta kortbärande bokning som fallback.

const WEEKDAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
const WEEKDAY_LABELS = ["Sön", "Mån", "Tis", "Ons", "Tor", "Fre", "Lör"];

export type NoShowReport = {
  kpis: {
    noShowSharePct: number | null;
    noShowShareBeforePct: number | null;
    chargedTotal: number;
    chargedGuests: number;
    cancellations: number;
    autoCancellations: number;
    avgOccupancyPct: number | null;
  };
  weeklyNoShows: { week: string; count: number; afterGuarantee: boolean }[];
  dowOccupancy: { day: string; pct: number | null }[];
  guaranteeIntroduced: boolean;
};

function isoWeek(d: Date): number {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil(((date.getTime() - yearStart.getTime()) / 864e5 + 1) / 7);
}

export async function getNoShowReport(
  restaurantId: string,
  config: RestaurantConfig,
  totalSeats: number,
): Promise<NoShowReport> {
  const now = new Date();
  const since90 = new Date(now.getTime() - 90 * 864e5);
  const since56 = new Date(now.getTime() - 56 * 864e5);
  const since30 = new Date(now.getTime() - 30 * 864e5);

  const history = await prisma.booking.findMany({
    where: { restaurantId, startsAt: { gte: since90, lte: now } },
    select: {
      status: true,
      startsAt: true,
      partySize: true,
      charged: true,
      cancelInfo: true,
    },
  });

  // Referenspunkt för före/efter: inställningens datum, annars äldsta
  // bokningen som bär kort (kortfälten gallras — createdAt räcker ändå
  // som pragmatisk introduktionsmarkör)
  let refDate: Date | null = config.cardGuaranteeSince
    ? new Date(`${config.cardGuaranteeSince}T00:00:00Z`)
    : null;
  if (!refDate) {
    const firstCard = await prisma.booking.findFirst({
      where: {
        restaurantId,
        OR: [{ cardPspToken: { not: null } }, { cardLast4: { not: null } }],
      },
      orderBy: { createdAt: "asc" },
      select: { createdAt: true },
    });
    refDate = firstCard?.createdAt ?? null;
  }

  // "Besök som skulle skett": genomförda + sittande + no-shows.
  // Avbokade och preliminära räknas inte in i andelen.
  const isVisitLike = (s: string) =>
    s === "COMPLETED" || s === "SEATED" || s === "NO_SHOW" || s === "CONFIRMED";
  const share = (rows: typeof history): number | null => {
    const denom = rows.filter((b) => isVisitLike(b.status));
    if (denom.length === 0) return null;
    const noShows = denom.filter((b) => b.status === "NO_SHOW").length;
    return Math.round((noShows / denom.length) * 1000) / 10;
  };

  const last30 = history.filter((b) => b.startsAt >= since30);
  const noShowSharePct = share(last30);
  const noShowShareBeforePct = refDate
    ? share(history.filter((b) => b.startsAt < refDate))
    : null;

  const chargedRows = last30.filter((b) => b.charged !== null);
  const chargedTotal = chargedRows.reduce(
    (sum, b) => sum + Number(b.charged),
    0,
  );
  const chargedGuests = chargedRows.reduce((sum, b) => sum + b.partySize, 0);

  const cancelled30 = last30.filter((b) => b.status === "CANCELLED");
  const autoCancellations = cancelled30.filter(
    (b) => (b.cancelInfo as { av?: string } | null)?.av === "auto",
  ).length;

  // Beläggning: boka gäster per lokal dag / platser; snitt per veckodag
  // över de öppna dagarna i 30-dagarsfönstret
  const dateFmt = new Intl.DateTimeFormat("sv-SE", {
    timeZone: config.timezone,
  });
  const dayGuests = new Map<string, number>();
  for (const b of last30) {
    if (b.status === "CANCELLED" || b.status === "NO_SHOW") continue;
    const key = dateFmt.format(b.startsAt);
    dayGuests.set(key, (dayGuests.get(key) ?? 0) + b.partySize);
  }
  const perWeekday = new Map<number, { sum: number; days: number }>();
  const dailyPcts: number[] = [];
  for (let offset = 1; offset <= 30; offset++) {
    const d = new Date(now.getTime() - offset * 864e5);
    const key = dateFmt.format(d);
    const weekdayIdx = new Date(`${key}T12:00:00Z`).getUTCDay();
    const weekdayKey = WEEKDAY_KEYS[weekdayIdx];
    const open = (config.openingHours[weekdayKey] ?? []).length > 0;
    if (!open || config.closedDates.includes(key)) continue;
    const pct =
      totalSeats > 0
        ? Math.min(100, Math.round(((dayGuests.get(key) ?? 0) / totalSeats) * 100))
        : 0;
    dailyPcts.push(pct);
    const agg = perWeekday.get(weekdayIdx) ?? { sum: 0, days: 0 };
    agg.sum += pct;
    agg.days += 1;
    perWeekday.set(weekdayIdx, agg);
  }
  const avgOccupancyPct =
    dailyPcts.length > 0
      ? Math.round(dailyPcts.reduce((a, b) => a + b, 0) / dailyPcts.length)
      : null;
  // Mån–Sön i visningsordning
  const dowOccupancy = [1, 2, 3, 4, 5, 6, 0].map((idx) => {
    const agg = perWeekday.get(idx);
    return {
      day: WEEKDAY_LABELS[idx],
      pct: agg && agg.days > 0 ? Math.round(agg.sum / agg.days) : null,
    };
  });

  // No-shows per ISO-vecka, senaste 8 veckorna
  const weekBuckets = new Map<string, { count: number; after: boolean }>();
  for (let offset = 7; offset >= 0; offset--) {
    const d = new Date(now.getTime() - offset * 7 * 864e5);
    weekBuckets.set(`v. ${isoWeek(d)}`, {
      count: 0,
      after: refDate ? d >= refDate : false,
    });
  }
  for (const b of history) {
    if (b.status !== "NO_SHOW" || b.startsAt < since56) continue;
    const key = `v. ${isoWeek(b.startsAt)}`;
    const bucket = weekBuckets.get(key);
    if (bucket) bucket.count += 1;
  }

  return {
    kpis: {
      noShowSharePct,
      noShowShareBeforePct,
      chargedTotal,
      chargedGuests,
      cancellations: cancelled30.length,
      autoCancellations,
      avgOccupancyPct,
    },
    weeklyNoShows: [...weekBuckets.entries()].map(([week, v]) => ({
      week,
      count: v.count,
      afterGuarantee: v.after,
    })),
    dowOccupancy,
    guaranteeIntroduced: refDate !== null,
  };
}
