import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/client";
import { parseRestaurantConfig } from "@/lib/email-concierge/types";
import { createBooking } from "@/lib/booking/availability";
import { embed } from "@/lib/ai/embeddings";
import { setInteractionEmbedding } from "@/lib/db/vector";

const bookRequestSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  time: z.string().regex(/^\d{2}:\d{2}$/),
  partySize: z.number().int().min(1),
  name: z.string().min(1).max(120),
  phone: z.string().min(5).max(30),
  email: z.email(),
  notes: z.string().max(500).optional(),
});

// POST /api/widget/demo/book → skapar CONFIRMED-bokning direkt (widgetflödet)
export async function POST(
  request: NextRequest,
  ctx: RouteContext<"/api/widget/[slug]/book">,
) {
  const { slug } = await ctx.params;
  const parsed = bookRequestSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Ogiltiga bokningsuppgifter", details: parsed.error.issues },
      { status: 400 },
    );
  }
  const body = parsed.data;

  const restaurant = await prisma.restaurant.findUnique({ where: { slug } });
  if (!restaurant) {
    return NextResponse.json({ error: "Okänd restaurang" }, { status: 404 });
  }
  const config = parseRestaurantConfig(restaurant.config);

  // Stora sällskap hanteras manuellt — samma tröskel som mejl-conciergen
  if (body.partySize > config.escalationPartySize) {
    return NextResponse.json(
      {
        error: `För sällskap över ${config.escalationPartySize} personer — mejla oss så ordnar vi det personligen.`,
        escalate: true,
      },
      { status: 422 },
    );
  }

  const guest = await prisma.guest.upsert({
    where: {
      restaurantId_email: { restaurantId: restaurant.id, email: body.email },
    },
    update: { name: body.name, phone: body.phone },
    create: {
      restaurantId: restaurant.id,
      email: body.email,
      name: body.name,
      phone: body.phone,
    },
  });

  const result = await createBooking(
    restaurant.id,
    config,
    guest.id,
    body.date,
    body.time,
    body.partySize,
    body.notes,
    { status: "CONFIRMED", createdBy: "widget" },
  );
  if (!result.ok) {
    return NextResponse.json({ error: result.reason }, { status: 409 });
  }

  // Guest Intelligence: widgetbokningen blir en sökbar interaktion.
  // Embedding är best-effort — bokningen ska inte falla på ett OpenAI-fel.
  const summary =
    `Bokade via widgeten: ${body.partySize} personer ${body.date} kl ${body.time}` +
    (body.notes ? `. Önskemål: ${body.notes}` : "");
  try {
    const interaction = await prisma.guestInteraction.create({
      data: {
        guestId: guest.id,
        type: "WIDGET",
        intent: "BOOKING_REQUEST",
        rawContent: summary,
        summary,
      },
    });
    await setInteractionEmbedding(interaction.id, await embed(summary));
    await prisma.guestProfile.upsert({
      where: { guestId: guest.id },
      update: {},
      create: { guestId: guest.id },
    });
  } catch (e) {
    console.error("Kunde inte spara widget-interaktion:", e);
  }

  return NextResponse.json({
    bookingId: result.bookingId,
    tableName: result.tableName,
    date: body.date,
    time: body.time,
    partySize: body.partySize,
  });
}
