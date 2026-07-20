import { z } from "zod";
import type { Intent } from "../generated/prisma/enums";

// --- Restaurangkonfiguration (Restaurant.config JSONB) ---

const timeRangeSchema = z.object({
  open: z.string().regex(/^\d{2}:\d{2}$/), // "17:00"
  close: z.string().regex(/^\d{2}:\d{2}$/),
});

export const restaurantConfigSchema = z.object({
  timezone: z.string().default("Europe/Stockholm"),
  /** Nycklar: mon|tue|wed|thu|fri|sat|sun. Saknad dag = stängt. */
  openingHours: z.record(z.string(), z.array(timeRangeSchema)).default({}),
  bookingDurationMinutes: z.number().int().positive().default(120),
  /** Sällskap större än detta eskaleras till manuell hantering. */
  escalationPartySize: z.number().int().positive().default(8),
  /** Intent-confidence under detta → eskalering istället för utkast. */
  confidenceThreshold: z.number().min(0).max(1).default(0.7),
  tone: z
    .object({
      styleGuide: z.string().default(""),
      fewShotExamples: z
        .array(z.object({ guest: z.string(), reply: z.string() }))
        .default([]),
    })
    .default({ styleGuide: "", fewShotExamples: [] }),
  menu: z.string().default(""),
  /** Sittningar/upplevelser som visas som kort på widgetens startsida. */
  offerings: z
    .array(
      z.object({
        id: z.string(),
        title: z.string(),
        description: z.string().default(""),
        imageUrl: z.string().default(""),
      }),
    )
    .default([]),
  /** Valfri hjältebild för widgetens högerpanel. */
  heroImageUrl: z.string().default(""),
  /** Valfri logga — visas centrerad på hjältebilden istället för namnet i text. */
  logoUrl: z.string().default(""),
  /** Gatuadress — krävs innan Bokningsassistenten kan aktiveras. */
  address: z.string().default(""),
  /** Röda dagar (YYYY-MM-DD): stängt helt — inga bokningar, oavsett kanal. */
  closedDates: z.array(z.string()).default([]),
  /** Bokningsstopp (YYYY-MM-DD): öppet, men gästkanaler kan inte boka nytt. */
  bookingStopDates: z.array(z.string()).default([]),
  /** Klockslag (HH:MM) efter vilket gäster inte kan boka för samma dag. null = av. */
  sameDayCutoff: z.string().nullable().default("14:00"),
  /** No-show-avgift i kr per gäst i sällskapet (§2 p.1). */
  noShowFeePerGuest: z.number().int().min(0).max(10_000).default(250),
  /**
   * Ett fönster, två användningar (§2b p.2): styr BÅDE fri avbokning/ändring
   * OCH auto-avbokningsdeadline för preliminära bokningar. Deadline beräknas
   * alltid vid läsning (startsAt − fönster), lagras aldrig. max(72) gör
   * auto-avbokningsjobbets SQL-förfilter (startsAt <= now + 72h) bevisbart säkert.
   */
  cancellationWindowHours: z.number().int().min(1).max(72).default(4),
  /** false → widgeten hoppar över kortsteget och bokar bekräftat direkt; no-show kan då bara markeras utan avgift. */
  cardGuaranteeRequired: z.boolean().default(true),
  /** YYYY-MM-DD när kortgarantin senast slogs på — referenspunkt för rapporternas före/efter. */
  cardGuaranteeSince: z.string().nullable().default(null),
  /** Eventdagar (YYYY-MM-DD): visas som händelse — blockerar inget (§3.11). */
  eventDates: z.array(z.string()).default([]),
  /** Depositionsdagar (YYYY-MM-DD): förbokning med avgift — endast listning, flödet är utanför scope (§3.11, §4). */
  depositDates: z.array(z.string()).default([]),
  /** Personalvyernas tema: classic = ursprungliga mörkgrön/guld, warm = GPG-terrakotta, light = ljus. */
  theme: z.enum(["classic", "warm", "light"]).default("classic"),
  /** Gästwidgetens tema — oberoende av personalvyn. */
  widgetTheme: z.enum(["classic", "warm-light"]).default("classic"),
  /** Telefonagentens inställningar (Bokningsassistenten). */
  voiceAgent: z
    .object({
      /** gpt-realtime voice-id (whitelablas i UI:t). */
      voice: z.string().default("coral"),
      greeting: z.string().default(""),
      maxWaitSeconds: z.number().int().min(5).max(120).default(20),
      transferNumber: z.string().default(""),
      phoneNumber: z.string().default(""), // köpt E.164-nummer
      phoneSid: z.string().default(""), // Twilio IncomingPhoneNumber SID
    })
    .default({
      voice: "coral",
      greeting: "",
      maxWaitSeconds: 20,
      transferNumber: "",
      phoneNumber: "",
      phoneSid: "",
    }),
});

export type RestaurantConfig = z.infer<typeof restaurantConfigSchema>;

export function parseRestaurantConfig(raw: unknown): RestaurantConfig {
  return restaurantConfigSchema.parse(raw ?? {});
}

// --- Concierge-pipelinens in- och utdata ---

export const inboundEmailSchema = z.object({
  from: z.email(),
  subject: z.string(),
  body: z.string().min(1),
  receivedAt: z.iso.datetime().optional(),
});

export type InboundEmail = z.infer<typeof inboundEmailSchema>;

export type IntentResult = {
  intent: Intent;
  confidence: number;
  extracted: {
    date?: string; // "2026-07-10"
    time?: string; // "19:00"
    partySize?: number;
    name?: string;
    phone?: string;
  };
};

export type ToolCallRecord = {
  name: string;
  arguments: Record<string, unknown>;
  result: unknown;
};

export type ConciergeResult = {
  restaurantSlug: string;
  guestId: string;
  threadId: string;
  intent: Intent;
  confidence: number;
  toolCalls: ToolCallRecord[];
  outcome:
    | { kind: "draft"; reply: string }
    | { kind: "escalated"; reason: string };
  bookingId?: string;
};
