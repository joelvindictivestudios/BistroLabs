import { z } from "zod";
import type { RestaurantConfig } from "../email-concierge/types";

// Öppettider med flera pass per dag (lunch + middag). Motorn i
// lib/booking/availability.ts itererar redan alla pass — den här modulen ser
// till att API:t kan ta emot och validera dem utan att tappa data (tidigare
// skrev PATCH alltid tillbaka ett enda pass, vilket tyst raderade extrapass).

export const WEEKDAYS = [
  "mon",
  "tue",
  "wed",
  "thu",
  "fri",
  "sat",
  "sun",
] as const;
export type Weekday = (typeof WEEKDAYS)[number];

const WEEKDAY_LABELS: Record<Weekday, string> = {
  mon: "mån",
  tue: "tis",
  wed: "ons",
  thu: "tor",
  fri: "fre",
  sat: "lör",
  sun: "sön",
};

const rangeSchema = z.object({
  open: z.string().regex(/^\d{2}:\d{2}$/),
  close: z.string().regex(/^\d{2}:\d{2}$/),
});

/**
 * Bakåtkompatibelt dagformat: gamla klienter skickar `{open,close}` eller
 * `null` (stängt); nya skickar en lista pass ("[]" = stängt).
 */
const dayHoursSchema = z
  .union([rangeSchema, z.array(rangeSchema).max(4)])
  .nullable();

export const openingHoursPatchSchema = z.partialRecord(
  z.enum(WEEKDAYS),
  dayHoursSchema,
);

export type OpeningHoursPatch = z.infer<typeof openingHoursPatchSchema>;

function toMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

/**
 * Normalisera inskickade öppettider till motorns format
 * (`Record<weekday, {open, close}[]>`) och validera per dag:
 * open < close per pass (ingen midnattspassage — motorns antagande),
 * sorterade pass utan överlapp. Minst en dag måste vara öppen.
 */
export function normalizeOpeningHours(
  input: OpeningHoursPatch,
):
  | { ok: true; openingHours: RestaurantConfig["openingHours"] }
  | { ok: false; error: string } {
  const openingHours: RestaurantConfig["openingHours"] = {};
  for (const day of WEEKDAYS) {
    const value = input[day];
    if (value === undefined || value === null) continue;
    const ranges = Array.isArray(value) ? [...value] : [value];
    if (ranges.length === 0) continue;
    ranges.sort((a, b) => toMinutes(a.open) - toMinutes(b.open));
    for (const range of ranges) {
      if (toMinutes(range.open) >= toMinutes(range.close)) {
        return {
          ok: false,
          error: `Stängningstiden måste vara efter öppningstiden (${WEEKDAY_LABELS[day]})`,
        };
      }
    }
    for (let i = 1; i < ranges.length; i++) {
      if (toMinutes(ranges[i - 1].close) > toMinutes(ranges[i].open)) {
        return {
          ok: false,
          error: `Passen överlappar varandra (${WEEKDAY_LABELS[day]})`,
        };
      }
    }
    openingHours[day] = ranges;
  }
  if (Object.keys(openingHours).length === 0) {
    return { ok: false, error: "Minst en dag måste ha öppettider." };
  }
  return { ok: true, openingHours };
}
