import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/client";
import { getUser } from "@/lib/auth/server";

const patchSchema = z.object({
  body: z.string().min(1).max(5000),
});

// PATCH /api/restaurants/{slug}/inbox/{messageId} — redigera AI:ns utkast
// innan det godkänns. Även eskalerade meddelanden redigeras här (personalen
// skriver svaret på de "svåra" mejlen innan de skickar).
export async function PATCH(
  request: NextRequest,
  ctx: RouteContext<"/api/restaurants/[slug]/inbox/[messageId]">,
) {
  const user = await getUser();
  if (!user) {
    return NextResponse.json({ error: "Inte inloggad." }, { status: 401 });
  }
  const { slug, messageId } = await ctx.params;
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

  const message = await prisma.emailMessage.findFirst({
    where: { id: messageId, thread: { restaurantId: restaurant.id } },
  });
  if (!message) {
    return NextResponse.json({ error: "Okänt meddelande." }, { status: 404 });
  }
  if (
    message.direction !== "OUTBOUND" ||
    (message.status !== "DRAFT" && message.status !== "ESCALATED")
  ) {
    return NextResponse.json(
      { error: "Bara utkast kan redigeras." },
      { status: 409 },
    );
  }

  const parsed = patchSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Ogiltigt utkast." },
      { status: 400 },
    );
  }

  await prisma.emailMessage.update({
    where: { id: message.id },
    data: { body: parsed.data.body },
  });
  return NextResponse.json({ ok: true });
}
