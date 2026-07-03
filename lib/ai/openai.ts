import OpenAI from "openai";

let client: OpenAI | undefined;

export function getOpenAI(): OpenAI {
  if (!client) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error("OPENAI_API_KEY saknas — fyll i .env (se .env.example)");
    }
    client = new OpenAI({ apiKey });
  }
  return client;
}

// Modell-id:n är env-drivna: namnen i planeringsdokumentet kan avvika från
// verkliga API-id:n, och de byts utan kodändring. Failar högt vid API-avslag.
export const MODELS = {
  classifier: process.env.OPENAI_MODEL_CLASSIFIER ?? "gpt-5.4-nano",
  generator: process.env.OPENAI_MODEL_GENERATOR ?? "gpt-5.4-mini",
  summarizer: process.env.OPENAI_MODEL_SUMMARIZER ?? "gpt-5.4-nano",
  embedding: process.env.OPENAI_EMBEDDING_MODEL ?? "text-embedding-3-small",
} as const;
