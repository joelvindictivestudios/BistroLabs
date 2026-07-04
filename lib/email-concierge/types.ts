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
