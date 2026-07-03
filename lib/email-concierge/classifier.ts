import { z } from "zod";
import { getOpenAI, MODELS } from "../ai/openai";
import type { InboundEmail, IntentResult } from "./types";

const INTENT_VALUES = [
  "BOOKING_REQUEST",
  "BOOKING_MODIFY",
  "BOOKING_CANCEL",
  "QUESTION",
  "COMPLAINT",
  "OTHER",
] as const;

const intentResponseSchema = z.object({
  intent: z.enum(INTENT_VALUES),
  confidence: z.number().min(0).max(1),
  extracted: z.object({
    date: z.string().nullable(),
    time: z.string().nullable(),
    partySize: z.number().int().positive().nullable(),
    name: z.string().nullable(),
    phone: z.string().nullable(),
  }),
});

/** Kastas när modellen svarar oparsebart — orchestratorn eskalerar då. */
export class ClassificationError extends Error {}

export async function classifyIntent(
  email: InboundEmail,
  today: string, // "YYYY-MM-DD", för att tolka relativa datum ("på fredag")
): Promise<IntentResult> {
  const response = await getOpenAI().chat.completions.create({
    model: MODELS.classifier,
    messages: [
      {
        role: "system",
        content:
          `Du klassificerar inkommande restaurangmejl. Dagens datum: ${today}. ` +
          "Extrahera bokningsdetaljer om de finns. Tolka relativa datum " +
          '("på fredag", "imorgon") till absolut datum YYYY-MM-DD. Tid som HH:MM (24h). ' +
          "Sätt fält till null när informationen saknas. confidence är din säkerhet " +
          "på intent-klassificeringen (0–1).",
      },
      {
        role: "user",
        content: `Ämne: ${email.subject}\n\nMejl:\n${email.body}`,
      },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "intent_classification",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          required: ["intent", "confidence", "extracted"],
          properties: {
            intent: { type: "string", enum: [...INTENT_VALUES] },
            confidence: { type: "number" },
            extracted: {
              type: "object",
              additionalProperties: false,
              required: ["date", "time", "partySize", "name", "phone"],
              properties: {
                date: { type: ["string", "null"] },
                time: { type: ["string", "null"] },
                partySize: { type: ["integer", "null"] },
                name: { type: ["string", "null"] },
                phone: { type: ["string", "null"] },
              },
            },
          },
        },
      },
    },
  });

  const raw = response.choices[0]?.message?.content;
  if (!raw) throw new ClassificationError("Tomt svar från klassificeraren");

  let parsed: z.infer<typeof intentResponseSchema>;
  try {
    parsed = intentResponseSchema.parse(JSON.parse(raw));
  } catch (e) {
    throw new ClassificationError(
      `Oparsebart klassificeringssvar: ${e instanceof Error ? e.message : e}`,
    );
  }

  return {
    intent: parsed.intent,
    confidence: parsed.confidence,
    extracted: {
      date: parsed.extracted.date ?? undefined,
      time: parsed.extracted.time ?? undefined,
      partySize: parsed.extracted.partySize ?? undefined,
      name: parsed.extracted.name ?? undefined,
      phone: parsed.extracted.phone ?? undefined,
    },
  };
}
