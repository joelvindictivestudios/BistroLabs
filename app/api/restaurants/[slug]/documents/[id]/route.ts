import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db/client";
import { getUser } from "@/lib/auth/server";

// DELETE /api/restaurants/{slug}/documents/{id} — ta bort ett kunskapsdokument.
export async function DELETE(
  _request: NextRequest,
  ctx: RouteContext<"/api/restaurants/[slug]/documents/[id]">,
) {
  const user = await getUser();
  if (!user) {
    return NextResponse.json({ error: "Inte inloggad." }, { status: 401 });
  }
  const { slug, id } = await ctx.params;
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

  const { count } = await prisma.knowledgeDocument.deleteMany({
    where: { id, restaurantId: restaurant.id },
  });
  if (count === 0) {
    return NextResponse.json({ error: "Okänt dokument." }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
