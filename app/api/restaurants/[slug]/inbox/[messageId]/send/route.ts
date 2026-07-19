import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db/client";
import { getUser } from "@/lib/auth/server";
import { sendEmail } from "@/lib/messaging/send";

// POST /api/restaurants/{slug}/inbox/{messageId}/send — "Godkänn & skicka".
// Enda vägen till MessageStatus SENT: orchestratorn skickar aldrig själv,
// varje utskick kräver personalens uttryckliga godkännande.
export async function POST(
  request: NextRequest,
  ctx: RouteContext<"/api/restaurants/[slug]/inbox/[messageId]/send">,
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
    include: {
      thread: { include: { guest: { select: { email: true } } } },
    },
  });
  if (!message) {
    return NextResponse.json({ error: "Okänt meddelande." }, { status: 404 });
  }
  if (
    message.direction !== "OUTBOUND" ||
    (message.status !== "DRAFT" && message.status !== "ESCALATED")
  ) {
    return NextResponse.json(
      { error: "Bara utkast kan skickas." },
      { status: 409 },
    );
  }
  if (!message.body.trim()) {
    return NextResponse.json(
      { error: "Skriv ett svar innan du skickar." },
      { status: 400 },
    );
  }

  // Mottagare: gästens e-post, annars avsändaren på trådens första inkommande
  let to = message.thread.guest?.email ?? null;
  if (!to) {
    const inbound = await prisma.emailMessage.findFirst({
      where: { threadId: message.threadId, direction: "INBOUND" },
      orderBy: { createdAt: "asc" },
      select: { fromAddress: true },
    });
    to = inbound?.fromAddress ?? null;
  }
  if (!to) {
    return NextResponse.json(
      { error: "Tråden saknar mottagaradress." },
      { status: 400 },
    );
  }

  const sent = await sendEmail({
    to,
    subject: `Re: ${message.thread.subject}`,
    text: message.body,
  });
  if (!sent.ok) {
    return NextResponse.json(
      { error: "Mejlet kunde inte skickas — försök igen." },
      { status: 502 },
    );
  }

  await prisma.emailMessage.update({
    where: { id: message.id },
    data: { status: "SENT", handledAt: null },
  });
  return NextResponse.json({ ok: true, status: "SENT" });
}
