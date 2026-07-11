import type { RestaurantConfig } from "../email-concierge/types";

// Gästkanalernas bokningsspärrar (widget + AI-agenter). Personalens
// drop-in-flöde anropar INTE dessa — staff får boka på bokningsstopp-dagar
// och efter same-day-cutoff. Röda dagar (closedDates) hanteras i
// availability-motorn och gäller alla kanaler.

/** "HH:MM" just nu i restaurangens tidszon. */
function nowInTimezone(timeZone: string): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat("sv-SE", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    time: `${get("hour")}:${get("minute")}`,
  };
}

/**
 * Returnerar spärrorsak för gästbokningar på ett datum, eller null om fritt.
 */
export function guestBookingBlocked(
  config: RestaurantConfig,
  date: string, // YYYY-MM-DD
): string | null {
  if (config.bookingStopDates.includes(date)) {
    return "Bokningsstopp denna dag — ring oss så hjälper vi dig.";
  }
  if (config.sameDayCutoff) {
    const now = nowInTimezone(config.timezone);
    if (date === now.date && now.time > config.sameDayCutoff) {
      return `Bokningar för samma dag stängde kl ${config.sameDayCutoff} — välkommen som drop-in eller ring oss.`;
    }
  }
  return null;
}
