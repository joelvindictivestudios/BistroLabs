import { embed } from "../ai/embeddings";
import { searchKnowledge, searchInteractions } from "../db/vector";

export type RetrievedContext = {
  knowledge: string;
  history: string;
  queryEmbedding: number[];
};

/** RAG: hämta relevanta kunskapsdokument + gästens tidigare interaktioner. */
export async function retrieveContext(
  restaurantId: string,
  guestId: string,
  emailBody: string,
  topK = 4,
): Promise<RetrievedContext> {
  const queryEmbedding = await embed(emailBody);

  const [docs, interactions] = await Promise.all([
    searchKnowledge(restaurantId, queryEmbedding, topK),
    searchInteractions(guestId, queryEmbedding, topK),
  ]);

  const knowledge = docs
    .map((d) => `[${d.category}] ${d.title}: ${d.content}`)
    .join("\n");
  const history = interactions
    .filter((i) => i.summary)
    .map((i) => `(${i.created_at.toISOString().slice(0, 10)}) ${i.summary}`)
    .join("\n");

  return { knowledge, history, queryEmbedding };
}
