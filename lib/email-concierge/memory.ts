import { getOpenAI, MODELS } from "../ai/openai";
import { prisma } from "../db/client";
import { embed } from "../ai/embeddings";
import { setInteractionEmbedding } from "../db/vector";
import type { Intent } from "../generated/prisma/enums";
import type { InboundEmail } from "./types";

/**
 * Guest Intelligence-loopen: sammanfatta interaktionen med billig modell,
 * embedda sammanfattningen och spara — så nästa kontakt får historiken via RAG.
 */
export async function storeInteraction(
  guestId: string,
  email: InboundEmail,
  outcome: string, // utkastet eller eskaleringsorsaken
  intent: Intent,
): Promise<string> {
  const response = await getOpenAI().chat.completions.create({
    model: MODELS.summarizer,
    messages: [
      {
        role: "system",
        content:
          "Sammanfatta gästinteraktionen i 1–3 meningar på svenska. Fokusera på fakta " +
          "som är användbara vid nästa kontakt: vad gästen ville, preferenser/allergier, " +
          "särskilda tillfällen och vad utfallet blev.",
      },
      {
        role: "user",
        content: `Gästens mejl:\n${email.body}\n\nUtfall:\n${outcome}`,
      },
    ],
  });
  const summary =
    response.choices[0].message.content?.trim() || "Sammanfattning saknas";

  const interaction = await prisma.guestInteraction.create({
    data: {
      guestId,
      type: "EMAIL",
      intent,
      rawContent: `Ämne: ${email.subject}\n\n${email.body}`,
      summary,
    },
  });
  await setInteractionEmbedding(interaction.id, await embed(summary));

  // Se till att en profilrad finns; aggregering av preferenser är en v2-cron
  await prisma.guestProfile.upsert({
    where: { guestId },
    update: {},
    create: { guestId },
  });

  return summary;
}
