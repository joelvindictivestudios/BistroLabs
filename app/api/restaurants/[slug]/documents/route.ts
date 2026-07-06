import { NextResponse, type NextRequest } from "next/server";
import { PDFParse } from "pdf-parse";
import { prisma } from "@/lib/db/client";
import { getUser } from "@/lib/auth/server";
import { embedMany } from "@/lib/ai/embeddings";
import { setKnowledgeEmbedding } from "@/lib/db/vector";

const MAX_BYTES = 10 * 1024 * 1024;
const CHUNK_SIZE = 1200;
const CHUNK_OVERLAP = 150;
const CATEGORIES = ["menu", "wine", "policy", "other"] as const;

/** Chunka längre dokument med överlapp så RAG-träffar behåller kontext. */
function chunkText(text: string): string[] {
  const clean = text.replace(/\r/g, "").replace(/\n{3,}/g, "\n\n").trim();
  if (clean.length <= CHUNK_SIZE) return clean ? [clean] : [];
  const chunks: string[] = [];
  let start = 0;
  while (start < clean.length) {
    let end = Math.min(start + CHUNK_SIZE, clean.length);
    // Bryt helst vid stycke- eller radslut nära chunkgränsen
    if (end < clean.length) {
      const paragraphBreak = clean.lastIndexOf("\n\n", end);
      const lineBreak = clean.lastIndexOf("\n", end);
      const breakAt = paragraphBreak > start + CHUNK_SIZE / 2 ? paragraphBreak : lineBreak;
      if (breakAt > start + CHUNK_SIZE / 2) end = breakAt;
    }
    chunks.push(clean.slice(start, end).trim());
    if (end >= clean.length) break;
    start = end - CHUNK_OVERLAP;
  }
  return chunks.filter(Boolean);
}

async function extractText(file: File): Promise<string> {
  if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) {
    const parser = new PDFParse({ data: new Uint8Array(await file.arrayBuffer()) });
    const result = await parser.getText();
    return result.text ?? "";
  }
  return await file.text();
}

// POST /api/restaurants/{slug}/documents — multipart: file (.pdf/.txt/.md) + category.
// Extraherar text, chunkar, embeddar → knowledge_documents (RAG-källan för
// widget-chatten, mejl-conciergen och kommande voice-agenten).
export async function POST(
  request: NextRequest,
  ctx: RouteContext<"/api/restaurants/[slug]/documents">,
) {
  const user = await getUser();
  if (!user) {
    return NextResponse.json({ error: "Inte inloggad." }, { status: 401 });
  }
  const { slug } = await ctx.params;
  const restaurant = await prisma.restaurant.findUnique({ where: { slug } });
  if (!restaurant) {
    return NextResponse.json({ error: "Okänd restaurang." }, { status: 404 });
  }
  if (restaurant.ownerId !== user.id) {
    return NextResponse.json(
      { error: "Du äger inte den här restaurangen." },
      { status: 403 },
    );
  }

  const form = await request.formData();
  const file = form.get("file");
  const category = String(form.get("category") ?? "other");
  if (!(file instanceof File)) {
    return NextResponse.json(
      { error: 'Skicka filen som multipart-fältet "file".' },
      { status: 400 },
    );
  }
  if (!CATEGORIES.includes(category as (typeof CATEGORIES)[number])) {
    return NextResponse.json({ error: "Ogiltig kategori." }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "Max 10 MB per fil." }, { status: 400 });
  }
  const validName = /\.(pdf|txt|md)$/i.test(file.name);
  if (!validName) {
    return NextResponse.json(
      { error: "Endast .pdf, .txt eller .md." },
      { status: 400 },
    );
  }

  let text: string;
  try {
    text = await extractText(file);
  } catch {
    return NextResponse.json(
      { error: "Filen kunde inte läsas — är den skadad?" },
      { status: 400 },
    );
  }
  const chunks = chunkText(text);
  if (chunks.length === 0) {
    return NextResponse.json(
      {
        error:
          "Ingen text hittades i filen. Skannade PDF:er (bilder) stöds inte — klistra in innehållet som text istället.",
      },
      { status: 422 },
    );
  }

  const baseTitle = file.name.replace(/\.(pdf|txt|md)$/i, "");
  const embeddings = await embedMany(chunks);
  const created: string[] = [];
  for (let i = 0; i < chunks.length; i++) {
    const doc = await prisma.knowledgeDocument.create({
      data: {
        restaurantId: restaurant.id,
        category,
        title: chunks.length > 1 ? `${baseTitle} (del ${i + 1})` : baseTitle,
        content: chunks[i],
      },
    });
    await setKnowledgeEmbedding(doc.id, embeddings[i]);
    created.push(doc.id);
  }

  return NextResponse.json(
    { documentIds: created, chunks: chunks.length, title: baseTitle },
    { status: 201 },
  );
}
