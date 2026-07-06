import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/client";
import { getUser } from "@/lib/auth/server";
import { embed } from "@/lib/ai/embeddings";
import { setKnowledgeEmbedding } from "@/lib/db/vector";

const ALLOWED_TITLES = ["Avbokningspolicy", "Allergihantering"] as const;

const policySchema = z.object({
  title: z.enum(ALLOWED_TITLES),
  content: z.string().max(4000),
});

// PUT /api/restaurants/{slug}/policies — upsert av policy-text som
// kunskapsdokument (delete-by-title + insert + embed). Tom text = ta bort.
export async function PUT(
  request: NextRequest,
  ctx: RouteContext<"/api/restaurants/[slug]/policies">,
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

  const parsed = policySchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Ogiltig policy." }, { status: 400 });
  }
  const { title, content } = parsed.data;

  await prisma.knowledgeDocument.deleteMany({
    where: { restaurantId: restaurant.id, category: "policy", title },
  });

  const trimmed = content.trim();
  if (!trimmed) {
    return NextResponse.json({ ok: true, removed: true });
  }

  const doc = await prisma.knowledgeDocument.create({
    data: {
      restaurantId: restaurant.id,
      category: "policy",
      title,
      content: trimmed,
    },
  });
  await setKnowledgeEmbedding(doc.id, await embed(`${title}\n${trimmed}`));

  return NextResponse.json({ ok: true, documentId: doc.id });
}
