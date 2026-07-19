import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/client";
import { getUser } from "@/lib/auth/server";

const claimSchema = z.object({ undo: z.boolean().optional() }).optional();

// POST /api/restaurants/{slug}/inbox/{messageId}/claim — "Jag tar den själv".
// Status (DRAFT/ESCALATED) behålls som historik över vad AI:n gjorde;
// handledAt tar meddelandet ur väntande-räknaren. { undo: true } ångrar.
export async function POST(
  request: NextRequest,
  ctx: RouteContext<"/api/restaurants/[slug]/inbox/[messageId]/claim">,
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
  if (message.direction !== "OUTBOUND" || message.status === "SENT") {
    return NextResponse.json(
      { error: "Bara väntande utkast kan tas över." },
      { status: 409 },
    );
  }

  const body = claimSchema.parse(
    await request.json().catch(() => undefined),
  );
  await prisma.emailMessage.update({
    where: { id: message.id },
    data: { handledAt: body?.undo ? null : new Date() },
  });
  return NextResponse.json({ ok: true });
}
