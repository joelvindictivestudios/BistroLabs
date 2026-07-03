import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { prisma } from "@/lib/db/client";
import { parseRestaurantConfig } from "@/lib/email-concierge/types";
import { getOpenAI, MODELS } from "@/lib/ai/openai";
import { embed } from "@/lib/ai/embeddings";
import { searchKnowledge } from "@/lib/db/vector";
import { checkAvailability } from "@/lib/booking/availability";

const chatRequestSchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().min(1).max(2000),
      }),
    )
    .min(1)
    .max(20),
});

const MAX_TOOL_ITERATIONS = 3;

// POST /api/widget/demo/chat — gästchatt: RAG-kunskap + tillgänglighetskoll.
// Chatten bokar aldrig själv; den guidar in i widgetflödet.
export async function POST(
  request: NextRequest,
  ctx: RouteContext<"/api/widget/[slug]/chat">,
) {
  const { slug } = await ctx.params;
  const parsed = chatRequestSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Ogiltigt chattformat" }, { status: 400 });
  }

  const restaurant = await prisma.restaurant.findUnique({ where: { slug } });
  if (!restaurant) {
    return NextResponse.json({ error: "Okänd restaurang" }, { status: 404 });
  }
  const config = parseRestaurantConfig(restaurant.config);

  const history = parsed.data.messages;
  const lastUserMessage = [...history].reverse().find((m) => m.role === "user")!;
  const knowledge = await searchKnowledge(
    restaurant.id,
    await embed(lastUserMessage.content),
    4,
  );
  const today = new Date().toISOString().slice(0, 10);

  const hours = Object.entries(config.openingHours)
    .map(([day, ranges]) =>
      ranges.length
        ? `${day}: ${ranges.map((r) => `${r.open}–${r.close}`).join(", ")}`
        : null,
    )
    .filter(Boolean)
    .join("; ");

  const systemPrompt = [
    `Du är gästchatt för restaurangen ${restaurant.name}. Dagens datum: ${today}.`,
    `Tonalitet: ${config.tone.styleGuide}`,
    config.menu ? `Om menyn: ${config.menu}` : "",
    `Öppettider: ${hours || "okända"}.`,
    knowledge.length
      ? `Relevant kunskap:\n${knowledge.map((k) => `[${k.category}] ${k.title}: ${k.content}`).join("\n")}`
      : "",
    "Regler:",
    "- Använd check_availability för frågor om lediga tider — gissa aldrig.",
    "- Du kan INTE slutföra bokningar i chatten. När gästen vill boka: hänvisa till bokningsflödet här på sidan (välj antal gäster, datum och tid).",
    `- Sällskap över ${config.escalationPartySize} personer hänvisas till mejl.`,
    "- Svara kort (2–4 meningar) på gästens språk. Håll dig till restaurangens ämnen.",
  ]
    .filter(Boolean)
    .join("\n\n");

  const messages: ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt },
    ...history,
  ];

  const client = getOpenAI();
  for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
    const response = await client.chat.completions.create({
      model: MODELS.generator,
      messages,
      tools: [
        {
          type: "function",
          function: {
            name: "check_availability",
            description: "Kolla om ett datum/tid har ledigt bord.",
            parameters: {
              type: "object",
              additionalProperties: false,
              required: ["date", "time", "party_size"],
              properties: {
                date: { type: "string", description: "YYYY-MM-DD" },
                time: { type: "string", description: "HH:MM (24h)" },
                party_size: { type: "integer", minimum: 1 },
              },
            },
          },
        },
      ],
    });
    const message = response.choices[0].message;
    messages.push(message);

    if (!message.tool_calls || message.tool_calls.length === 0) {
      return NextResponse.json({ reply: message.content ?? "" });
    }
    for (const call of message.tool_calls) {
      if (call.type !== "function") continue;
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(call.function.arguments || "{}");
      } catch {}
      const result = await checkAvailability(
        restaurant.id,
        config,
        String(args.date),
        String(args.time),
        Number(args.party_size),
      );
      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: JSON.stringify(result),
      });
    }
  }

  return NextResponse.json({
    reply: "Jag kunde tyvärr inte ta fram ett svar just nu — prova gärna igen.",
  });
}
