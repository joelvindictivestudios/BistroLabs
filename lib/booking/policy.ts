import type { RestaurantConfig } from "@/lib/email-concierge/types";

// No-show-skyddets tidsregler (§2b). Ett fönster, två användningar:
// cancellationWindowHours styr BÅDE fri avbokning/ändring OCH
// auto-avbokningsdeadline för preliminära bokningar.
//
// Deadline är ren UTC-aritmetik på startsAt (redan en UTC-instant) —
// använd ALDRIG localToUtc här (den är för "YYYY-MM-DD HH:MM" → instant).
// Visning formatteras med Intl i restaurangens tidszon.
// Beräknas alltid vid läsning, lagras aldrig (§2b p.3).

export function cancellationDeadline(
  startsAt: Date,
  config: Pick<RestaurantConfig, "cancellationWindowHours">,
): Date {
  return new Date(
    startsAt.getTime() - config.cancellationWindowHours * 3600_000,
  );
}

export function insideCancellationWindow(
  startsAt: Date,
  config: Pick<RestaurantConfig, "cancellationWindowHours">,
  now: Date = new Date(),
): boolean {
  return now >= cancellationDeadline(startsAt, config);
}

/** "kl 15:30" i restaurangens tidszon — för deadline-rader i UI och mejl. */
export function formatDeadlineTime(
  deadline: Date,
  timezone: string,
): string {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
  }).format(deadline);
}
