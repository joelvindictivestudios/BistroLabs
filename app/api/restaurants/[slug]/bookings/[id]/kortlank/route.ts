import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db/client";
import { getUser } from "@/lib/auth/server";
import { sendCardLink } from "@/lib/messaging/card-link";

// POST /api/restaurants/{slug}/bookings/{id}/kortlank — "Skicka kortlänken
// igen" (§3.3). Fungerar för alla preliminära bokningar med e-post — även
// AI-inkorgens, så personalen aktivt kan konvertera dem till kortflödet.
export async function POST(
  request: NextRequest,
  ctx: RouteContext<"/api/restaurants/[slug]/bookings/[id]/kortlank">,
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
  const booking = await prisma.booking.findFirst({
    where: { id, restaurantId: restaurant.id },
    select: { id: true },
  });
  if (!booking) {
    return NextResponse.json({ error: "Okänd bokning." }, { status: 404 });
  }

  const sent = await sendCardLink(booking.id, request.nextUrl.origin, {
    includeSms: true,
  });
  if (!sent.ok) {
    return NextResponse.json({ error: sent.error }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
