import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db/client";
import { getUser } from "@/lib/auth/server";

// DELETE /api/restaurants/{slug}/waitlist/{id} — ta bort en köplats
// (gästen har fått bord, ångrat sig eller dagen har passerat).
export async function DELETE(
  request: NextRequest,
  ctx: RouteContext<"/api/restaurants/[slug]/waitlist/[id]">,
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

  const deleted = await prisma.waitlistEntry.deleteMany({
    where: { id, restaurantId: restaurant.id },
  });
  if (deleted.count === 0) {
    return NextResponse.json({ error: "Okänd köplats." }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
