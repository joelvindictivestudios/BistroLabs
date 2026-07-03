import { prisma } from "./client";

// Prisma kan inte läsa/skriva Unsupported("vector")-kolumner — all vektor-I/O
// går via raw SQL. Vektorer skickas som text-literal och castas till ::vector.

function toVectorLiteral(vec: number[]): string {
  return `[${vec.join(",")}]`;
}

export async function setInteractionEmbedding(
  interactionId: string,
  embedding: number[],
): Promise<void> {
  await prisma.$executeRaw`
    UPDATE guest_interactions
    SET embedding = ${toVectorLiteral(embedding)}::vector
    WHERE id = ${interactionId}::uuid`;
}

export async function setKnowledgeEmbedding(
  documentId: string,
  embedding: number[],
): Promise<void> {
  await prisma.$executeRaw`
    UPDATE knowledge_documents
    SET embedding = ${toVectorLiteral(embedding)}::vector
    WHERE id = ${documentId}::uuid`;
}

export type KnowledgeHit = {
  id: string;
  category: string;
  title: string;
  content: string;
  distance: number;
};

/** Cosine-sökning bland en restaurangs kunskapsdokument (FAQ/policy/meny). */
export async function searchKnowledge(
  restaurantId: string,
  queryEmbedding: number[],
  limit = 5,
): Promise<KnowledgeHit[]> {
  return prisma.$queryRaw<KnowledgeHit[]>`
    SELECT id, category, title, content,
           (embedding <=> ${toVectorLiteral(queryEmbedding)}::vector)::float AS distance
    FROM knowledge_documents
    WHERE restaurant_id = ${restaurantId}::uuid AND embedding IS NOT NULL
    ORDER BY distance
    LIMIT ${limit}`;
}

export type InteractionHit = {
  id: string;
  type: string;
  summary: string | null;
  created_at: Date;
  distance: number;
};

/** Cosine-sökning bland en gästs tidigare interaktioner. */
export async function searchInteractions(
  guestId: string,
  queryEmbedding: number[],
  limit = 5,
): Promise<InteractionHit[]> {
  return prisma.$queryRaw<InteractionHit[]>`
    SELECT id, type, summary, created_at,
           (embedding <=> ${toVectorLiteral(queryEmbedding)}::vector)::float AS distance
    FROM guest_interactions
    WHERE guest_id = ${guestId}::uuid AND embedding IS NOT NULL
    ORDER BY distance
    LIMIT ${limit}`;
}
