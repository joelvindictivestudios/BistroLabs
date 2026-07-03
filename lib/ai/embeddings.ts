import { getOpenAI, MODELS } from "./openai";

/** Dimension för vector-kolumnerna i databasen — kopplad till text-embedding-3-small. */
export const EMBEDDING_DIMENSIONS = 1536;

export async function embed(text: string): Promise<number[]> {
  const [vector] = await embedMany([text]);
  return vector;
}

export async function embedMany(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const response = await getOpenAI().embeddings.create({
    model: MODELS.embedding,
    input: texts,
    dimensions: EMBEDDING_DIMENSIONS,
  });
  return response.data
    .sort((a, b) => a.index - b.index)
    .map((item) => item.embedding);
}
