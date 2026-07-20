import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/client";
import { getUser } from "@/lib/auth/server";
import { parseRestaurantConfig } from "@/lib/email-concierge/types";
import { sendSms } from "@/lib/messaging/sms";
import { appBaseUrl } from "@/lib/urls";

// POST /api/restaurants/{slug}/waitlist/{id}/offer — "Erbjud bord" (§3.8):
// köplatsen → OFFERED + SMS till gästen. Ingen CommunicationLog (kräver
// bookingId) — väntelisteposten själv (status/offeredTime/offeredAt) ÄR
// loggen. Först till kvarn; ingen bokning skapas förrän gästen hör av sig.

const offerSchema = z.object({
  time: z.string().regex(/^\d{2}:\d{2}$/),
});

export async function POST(
  request: NextRequest,
  ctx: RouteContext<"/api/restaurants/[slug]/waitlist/[id]/offer">,
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

  const parsed = offerSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Ange tid (HH:MM)." }, { status: 400 });
  }

  const entry = await prisma.waitlistEntry.findFirst({
    where: { id, restaurantId: restaurant.id },
  });
  if (!entry) {
    return NextResponse.json({ error: "Okänd köplats." }, { status: 404 });
  }

  // Dubbelklick-skydd: endast WAITING kan erbjudas
  const updated = await prisma.waitlistEntry.updateMany({
    where: { id: entry.id, status: "WAITING" },
    data: {
      status: "OFFERED",
      offeredTime: parsed.data.time,
      offeredAt: new Date(),
    },
  });
  if (updated.count === 0) {
    return NextResponse.json(
      { error: "Köplatsen är redan erbjuden." },
      { status: 409 },
    );
  }

  const config = parseRestaurantConfig(restaurant.config);
  const datum = new Date(`${entry.date}T12:00:00Z`).toLocaleDateString(
    "sv-SE",
    { day: "numeric", month: "long" },
  );
  await sendSms({
    to: entry.phone,
    text:
      `${restaurant.name}: Ett bord för ${entry.partySize} har blivit ledigt ` +
      `${datum} kl ${parsed.data.time}. Först till kvarn — ring oss eller boka: ` +
      `${appBaseUrl(request.nextUrl.origin)}/widget/${restaurant.slug}`,
    from: config.voiceAgent.phoneNumber || undefined,
  });

  return NextResponse.json({ ok: true });
}
