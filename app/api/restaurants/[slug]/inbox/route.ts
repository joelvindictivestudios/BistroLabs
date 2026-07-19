import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db/client";
import { getUser } from "@/lib/auth/server";

// GET /api/restaurants/{slug}/inbox — AI-inkorgen: mejltrådar med AI-utkast
// som väntar på granskning. ?counts=1 returnerar bara räknarna (sidofältets
// badge pollar billigt). Tenancy går alltid via EmailThread.restaurantId —
// EmailMessage saknar egen restaurantkoppling.

export async function GET(
  request: NextRequest,
  ctx: RouteContext<"/api/restaurants/[slug]/inbox">,
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

  const pendingBase = {
    thread: { restaurantId: restaurant.id },
    direction: "OUTBOUND" as const,
    handledAt: null,
  };
  const [drafts, escalated, sent] = await prisma.$transaction([
    prisma.emailMessage.count({
      where: { ...pendingBase, status: "DRAFT" },
    }),
    prisma.emailMessage.count({
      where: { ...pendingBase, status: "ESCALATED" },
    }),
    prisma.emailMessage.count({
      where: {
        thread: { restaurantId: restaurant.id },
        direction: "OUTBOUND",
        status: "SENT",
      },
    }),
  ]);
  const counts = { drafts, escalated, sent, pending: drafts + escalated };

  if (request.nextUrl.searchParams.get("counts") === "1") {
    return NextResponse.json({ counts });
  }

  const threads = await prisma.emailThread.findMany({
    where: { restaurantId: restaurant.id },
    orderBy: { createdAt: "desc" },
    take: 50,
    include: {
      guest: { select: { name: true, email: true } },
      messages: { orderBy: { createdAt: "asc" } },
    },
  });

  return NextResponse.json({
    counts,
    threads: threads.map((t) => ({
      id: t.id,
      subject: t.subject,
      guestName: t.guest?.name ?? null,
      guestEmail: t.guest?.email ?? null,
      createdAt: t.createdAt.toISOString(),
      messages: t.messages.map((m) => ({
        id: m.id,
        direction: m.direction,
        status: m.status,
        fromAddress: m.fromAddress,
        body: m.body,
        intent: m.intent,
        confidence: m.confidence,
        escalated: m.escalated,
        escalationReason: m.escalationReason,
        handledAt: m.handledAt?.toISOString() ?? null,
        createdAt: m.createdAt.toISOString(),
      })),
    })),
  });
}
