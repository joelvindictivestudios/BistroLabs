import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { getOpenAI, MODELS } from "../ai/openai";
import type { InboundEmail, RestaurantConfig, ToolCallRecord } from "./types";
import { toolDefinitions, executeTool, type ToolContext } from "./tools";

const MAX_TOOL_ITERATIONS = 5;

export type GeneratedReply = {
  draft: string;
  toolCalls: ToolCallRecord[];
};

export async function generateReply(
  ctx: ToolContext,
  restaurantName: string,
  email: InboundEmail,
  context: { knowledge: string; history: string },
  today: string,
): Promise<GeneratedReply> {
  const config: RestaurantConfig = ctx.config;

  const fewShots = config.tone.fewShotExamples
    .map((ex) => `Gäst: ${ex.guest}\nSvar: ${ex.reply}`)
    .join("\n\n");

  const systemPrompt = [
    `Du är e-postconcierge för restaurangen ${restaurantName}. Dagens datum: ${today}.`,
    `Tonalitet: ${config.tone.styleGuide}`,
    fewShots ? `Exempel på tidigare svar:\n${fewShots}` : "",
    config.menu ? `Om menyn: ${config.menu}` : "",
    context.knowledge ? `Relevant kunskap:\n${context.knowledge}` : "",
    context.history ? `Gästens historik:\n${context.history}` : "",
    "Regler:",
    "- Använd verktygen för att kolla tillgänglighet och boka — hitta ALDRIG på tillgänglighet.",
    "- Boka bara när datum, tid och antal gäster framgår av mejlet.",
    "- Om önskad tid är upptagen: kolla närliggande tider och föreslå alternativ.",
    "- Svara på gästens språk. Svaret är ett UTKAST som granskas av personal innan det skickas.",
    "- Returnera endast själva mejlsvaret, ingen metatext.",
  ]
    .filter(Boolean)
    .join("\n\n");

  const messages: ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: `Ämne: ${email.subject}\n\n${email.body}` },
  ];

  const toolCalls: ToolCallRecord[] = [];
  const client = getOpenAI();

  for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
    const response = await client.chat.completions.create({
      model: MODELS.generator,
      messages,
      tools: toolDefinitions,
    });
    const message = response.choices[0].message;
    messages.push(message);

    if (!message.tool_calls || message.tool_calls.length === 0) {
      return { draft: message.content ?? "", toolCalls };
    }

    for (const call of message.tool_calls) {
      if (call.type !== "function") continue;
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(call.function.arguments || "{}");
      } catch {
        // trasiga argument → låt verktyget svara med fel istället för att krascha
      }
      const result = await executeTool(ctx, call.function.name, args);
      toolCalls.push({ name: call.function.name, arguments: args, result });
      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: JSON.stringify(result),
      });
    }
  }

  // Tool-loopen tog inte slut inom budget — be om ett svar utan verktyg
  const final = await client.chat.completions.create({
    model: MODELS.generator,
    messages: [
      ...messages,
      {
        role: "system",
        content: "Avsluta nu med ditt bästa mejlsvar utan fler verktygsanrop.",
      },
    ],
  });
  return { draft: final.choices[0].message.content ?? "", toolCalls };
}
