import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/client";
import { parseRestaurantConfig } from "@/lib/email-concierge/types";

// POST /api/widget/{slug}/waitlist — "Ställ mig på väntelistan" (§3.8):
// gästens önskemål vid fullbokad tid. Publik som book-routen; zod-caps är
// abuse-skyddet. SMS går ut först när personalen erbjuder bord.

const waitlistSchema = z
  .object({
    name: z.string().min(1).max(120),
    phone: z.string().min(5).max(30),
    partySize: z.number().int().min(1).max(50),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    wishedFrom: z.string().regex(/^\d{2}:\d{2}$/),
    wishedTo: z.string().regex(/^\d{2}:\d{2}$/),
  })
  .refine((d) => d.wishedFrom < d.wishedTo, {
    message: "Sluttiden måste vara efter starttiden",
    path: ["wishedTo"],
  });

export async function POST(
  request: NextRequest,
  ctx: RouteContext<"/api/widget/[slug]/waitlist">,
) {
  const { slug } = await ctx.params;
  const parsed = waitlistSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Ogiltiga uppgifter" },
      { status: 400 },
    );
  }
  const body = parsed.data;

  const restaurant = await prisma.restaurant.findUnique({ where: { slug } });
  if (!restaurant) {
    return NextResponse.json({ error: "Okänd restaurang" }, { status: 404 });
  }
  const config = parseRestaurantConfig(restaurant.config);
  if (config.closedDates.includes(body.date)) {
    return NextResponse.json(
      { error: "Restaurangen är stängd den dagen." },
      { status: 409 },
    );
  }

  // Dubblettspärr: samma telefon + dag räcker med en köplats
  const existing = await prisma.waitlistEntry.findFirst({
    where: {
      restaurantId: restaurant.id,
      phone: body.phone,
      date: body.date,
      status: "WAITING",
    },
  });
  if (existing) {
    return NextResponse.json(
      { error: "Du står redan på väntelistan den dagen." },
      { status: 409 },
    );
  }

  const entry = await prisma.waitlistEntry.create({
    data: {
      restaurantId: restaurant.id,
      name: body.name.trim(),
      phone: body.phone.trim(),
      partySize: body.partySize,
      date: body.date,
      wishedFrom: body.wishedFrom,
      wishedTo: body.wishedTo,
    },
  });
  return NextResponse.json({ ok: true, entryId: entry.id }, { status: 201 });
}
