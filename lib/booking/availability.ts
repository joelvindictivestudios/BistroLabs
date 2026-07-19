import { prisma } from "../db/client";
import type { RestaurantConfig } from "../email-concierge/types";

// Klassisk greedy-allokering — inget LLM. Minsta lediga bord som rymmer
// sällskapet vinner. All tidszonshantering hålls i denna fil: gästens
// önskade tid tolkas i restaurangens tidszon och lagras som UTC.

export type AvailabilityResult =
  | {
      available: true;
      table: { id: string; name: string; capacity: number };
      startsAt: Date;
      endsAt: Date;
    }
  | { available: false; reason: string };

const WEEKDAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

/** Minuter öster om UTC för en tidszon vid ett givet ögonblick. */
function tzOffsetMinutes(instant: Date, timeZone: string): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
      .formatToParts(instant)
      .map((p) => [p.type, p.value]),
  );
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour) % 24,
    Number(parts.minute),
    Number(parts.second),
  );
  return (asUtc - instant.getTime()) / 60_000;
}

/** Tolka "YYYY-MM-DD" + "HH:MM" i restaurangens tidszon → UTC-instant. */
export function localToUtc(date: string, time: string, timeZone: string): Date {
  const naive = new Date(`${date}T${time}:00Z`);
  let utc = new Date(naive.getTime() - tzOffsetMinutes(naive, timeZone) * 60_000);
  // Andra passet fångar DST-övergångar där offset ändras mellan gissning och svar
  utc = new Date(naive.getTime() - tzOffsetMinutes(utc, timeZone) * 60_000);
  return utc;
}

function timeToMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

/**
 * Röd dag- + öppettidskoll för en önskad starttid. Hela bokningen
 * (start → start + duration, eller angivet slut) måste rymmas i ett pass.
 * Återanvänds av checkAvailability och personalens tidsändring i PATCH.
 */
export function withinOpeningHours(
  config: RestaurantConfig,
  date: string, // "YYYY-MM-DD"
  time: string, // "HH:MM"
  endTime?: string, // "HH:MM" — default start + bookingDurationMinutes
):
  | { ok: true; startsAt: Date; endsAt: Date }
  | { ok: false; reason: string } {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    !/^\d{2}:\d{2}$/.test(time) ||
    (endTime !== undefined && !/^\d{2}:\d{2}$/.test(endTime))
  ) {
    return { ok: false, reason: "Ogiltigt datum- eller tidsformat" };
  }

  // Röd dag: restaurangen är stängd — gäller alla kanaler, även personal
  if (config.closedDates.includes(date)) {
    return { ok: false, reason: `Stängt ${date} (röd dag)` };
  }

  const weekday = WEEKDAY_KEYS[new Date(`${date}T12:00:00Z`).getUTCDay()];
  const ranges = config.openingHours[weekday] ?? [];
  if (ranges.length === 0) {
    return { ok: false, reason: `Stängt på ${weekday} (${date})` };
  }
  const startMin = timeToMinutes(time);
  const endMin = endTime
    ? timeToMinutes(endTime)
    : startMin + config.bookingDurationMinutes;
  if (endMin <= startMin) {
    return { ok: false, reason: "Sluttiden måste vara efter starttiden" };
  }
  const withinHours = ranges.some(
    (r) => startMin >= timeToMinutes(r.open) && endMin <= timeToMinutes(r.close),
  );
  if (!withinHours) {
    const hours = ranges.map((r) => `${r.open}–${r.close}`).join(", ");
    return {
      ok: false,
      reason: `Utanför öppettiderna (${hours}); bokningen är ${endMin - startMin} min`,
    };
  }

  const startsAt = localToUtc(date, time, config.timezone);
  const endsAt = new Date(startsAt.getTime() + (endMin - startMin) * 60_000);
  return { ok: true, startsAt, endsAt };
}

export async function checkAvailability(
  restaurantId: string,
  config: RestaurantConfig,
  date: string, // "YYYY-MM-DD"
  time: string, // "HH:MM"
  partySize: number,
): Promise<AvailabilityResult> {
  const hours = withinOpeningHours(config, date, time);
  if (!hours.ok) {
    return { available: false, reason: hours.reason };
  }
  const { startsAt, endsAt } = hours;

  // Greedy: minsta bord som rymmer sällskapet (och tillåter så små sällskap —
  // "endast 2"-bord har minSeats 2) och saknar överlappande bokning
  const tables = await prisma.diningTable.findMany({
    where: {
      restaurantId,
      capacity: { gte: partySize },
      minSeats: { lte: partySize },
    },
    orderBy: [{ capacity: "asc" }, { name: "asc" }],
    include: {
      bookings: {
        where: {
          status: { notIn: ["CANCELLED", "NO_SHOW"] },
          startsAt: { lt: endsAt },
          endsAt: { gt: startsAt },
        },
        select: { id: true },
      },
    },
  });

  if (tables.length === 0) {
    return {
      available: false,
      reason: `Inget bord rymmer ${partySize} personer`,
    };
  }

  const free = tables.find((t) => t.bookings.length === 0);
  if (!free) {
    return {
      available: false,
      reason: `Fullbokat för ${partySize} personer ${date} kl ${time}`,
    };
  }

  return {
    available: true,
    table: { id: free.id, name: free.name, capacity: free.capacity },
    startsAt,
    endsAt,
  };
}

/**
 * Alla lediga starttider för ett datum + sällskap, i steg om `stepMinutes`.
 * En DB-fråga för hela dagen — overlapp-kollen sker i minnet per slot.
 */
export async function listAvailableSlots(
  restaurantId: string,
  config: RestaurantConfig,
  date: string, // "YYYY-MM-DD"
  partySize: number,
  stepMinutes = 30,
): Promise<string[]> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return [];
  if (config.closedDates.includes(date)) return []; // röd dag
  const weekday = WEEKDAY_KEYS[new Date(`${date}T12:00:00Z`).getUTCDay()];
  const ranges = config.openingHours[weekday] ?? [];

  const candidates: string[] = [];
  for (const range of ranges) {
    const close = timeToMinutes(range.close);
    for (
      let m = timeToMinutes(range.open);
      m + config.bookingDurationMinutes <= close;
      m += stepMinutes
    ) {
      const hh = String(Math.floor(m / 60)).padStart(2, "0");
      const mm = String(m % 60).padStart(2, "0");
      candidates.push(`${hh}:${mm}`);
    }
  }
  if (candidates.length === 0) return [];

  const durationMs = config.bookingDurationMinutes * 60_000;
  const windowStart = localToUtc(date, candidates[0], config.timezone);
  const windowEnd = new Date(
    localToUtc(date, candidates[candidates.length - 1], config.timezone).getTime() +
      durationMs,
  );
  const tables = await prisma.diningTable.findMany({
    where: {
      restaurantId,
      capacity: { gte: partySize },
      minSeats: { lte: partySize },
    },
    include: {
      bookings: {
        where: {
          status: { notIn: ["CANCELLED", "NO_SHOW"] },
          startsAt: { lt: windowEnd },
          endsAt: { gt: windowStart },
        },
        select: { startsAt: true, endsAt: true },
      },
    },
  });
  if (tables.length === 0) return [];

  return candidates.filter((time) => {
    const startsAt = localToUtc(date, time, config.timezone);
    const endsAt = new Date(startsAt.getTime() + durationMs);
    return tables.some((table) =>
      table.bookings.every((b) => b.endsAt <= startsAt || b.startsAt >= endsAt),
    );
  });
}

export type CreateBookingResult =
  | { ok: true; bookingId: string; tableName: string; startsAt: Date }
  | { ok: false; reason: string };

/** Kolla tillgänglighet och skapa bokning i ett svep (greedy-allokering). */
export async function createBooking(
  restaurantId: string,
  config: RestaurantConfig,
  guestId: string,
  date: string,
  time: string,
  partySize: number,
  notes?: string,
  opts?: { status?: "PENDING" | "CONFIRMED"; createdBy?: string },
): Promise<CreateBookingResult> {
  // Dubbelbokning stoppas i databasen av exclusion-constrainten
  // bookings_no_overlap (BLA-10). Förlorar vi racet mot en samtidig bokning
  // provar vi om — nästa försök ser vinnarens rad och tar ett annat bord.
  const MAX_ATTEMPTS = 3;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const availability = await checkAvailability(
      restaurantId,
      config,
      date,
      time,
      partySize,
    );
    if (!availability.available) {
      return { ok: false, reason: availability.reason };
    }
    try {
      const booking = await prisma.booking.create({
        data: {
          restaurantId,
          guestId,
          tableId: availability.table.id,
          startsAt: availability.startsAt,
          endsAt: availability.endsAt,
          partySize,
          notes,
          status: opts?.status ?? "PENDING",
          createdBy: opts?.createdBy ?? "concierge",
        },
      });
      return {
        ok: true,
        bookingId: booking.id,
        tableName: availability.table.name,
        startsAt: availability.startsAt,
      };
    } catch (e) {
      if (isOverlapViolation(e) && attempt < MAX_ATTEMPTS) continue;
      if (isOverlapViolation(e)) {
        return {
          ok: false,
          reason: `Tiden hann bokas av någon annan — försök med en annan tid.`,
        };
      }
      throw e;
    }
  }
  return { ok: false, reason: "Bokningen kunde inte genomföras — försök igen." };
}

/** Träff på exclusion-constrainten bookings_no_overlap (SQLSTATE 23P01). */
export function isOverlapViolation(e: unknown): boolean {
  if (!e || typeof e !== "object") return false;
  const text = `${"message" in e ? e.message : ""}${JSON.stringify(
    "meta" in e ? e.meta : "",
  )}`;
  return text.includes("bookings_no_overlap") || text.includes("23P01");
}
