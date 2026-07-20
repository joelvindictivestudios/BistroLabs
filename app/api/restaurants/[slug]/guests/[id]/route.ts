import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/client";
import { getUser } from "@/lib/auth/server";

const patchGuestSchema = z.object({
  name: z.string().max(120).nullable().optional(),
  email: z.email().nullable().optional(),
  phone: z.string().min(5).max(30).nullable().optional(),
  notes: z.string().max(1000).optional(),
  marketingConsent: z.boolean().optional(),
  /** Märkningar (§3.12): allergi / stamgäst / barnfamilj. */
  tags: z.array(z.string().min(1).max(30)).max(10).optional(),
});

// PATCH /api/restaurants/{slug}/guests/{id} — uppdatera kunduppgifter/notes.
export async function PATCH(
  request: NextRequest,
  ctx: RouteContext<"/api/restaurants/[slug]/guests/[id]">,
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
  const guest = await prisma.guest.findFirst({
    where: { id, restaurantId: restaurant.id },
  });
  if (!guest) {
    return NextResponse.json({ error: "Okänd kund." }, { status: 404 });
  }

  const parsed = patchGuestSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Ogiltiga uppgifter" },
      { status: 400 },
    );
  }
  const body = parsed.data;

  // Minst en kontaktväg måste finnas kvar efter uppdateringen
  const nextEmail = body.email !== undefined ? body.email : guest.email;
  const nextPhone = body.phone !== undefined ? body.phone : guest.phone;
  if (!nextEmail && !nextPhone) {
    return NextResponse.json(
      { error: "Kunden måste ha e-post eller telefonnummer." },
      { status: 400 },
    );
  }

  try {
    await prisma.guest.update({
      where: { id: guest.id },
      data: {
        ...(body.name !== undefined ? { name: body.name?.trim() || null } : {}),
        ...(body.email !== undefined ? { email: body.email } : {}),
        ...(body.phone !== undefined ? { phone: body.phone } : {}),
      },
    });
  } catch (e) {
    if (e && typeof e === "object" && "code" in e && e.code === "P2002") {
      return NextResponse.json(
        { error: "En annan kund har redan den e-posten/telefonnumret." },
        { status: 409 },
      );
    }
    throw e;
  }

  if (
    body.notes !== undefined ||
    body.marketingConsent !== undefined ||
    body.tags !== undefined
  ) {
    // Samtycket tidsstämplas vid opt-in (19 § MFL) och nollas vid opt-out
    const consentData =
      body.marketingConsent === undefined
        ? {}
        : body.marketingConsent
          ? { marketingConsent: true, marketingConsentAt: new Date() }
          : { marketingConsent: false, marketingConsentAt: null };
    const notesData =
      body.notes === undefined ? {} : { notes: body.notes.trim() || null };
    const tagsData = body.tags === undefined ? {} : { tags: body.tags };
    await prisma.guestProfile.upsert({
      where: { guestId: guest.id },
      update: { ...notesData, ...consentData, ...tagsData },
      create: { guestId: guest.id, ...notesData, ...consentData, ...tagsData },
    });
  }

  return NextResponse.json({ ok: true });
}

// GET /api/restaurants/{slug}/guests/{id} — gästprofilens händelsehistorik
// (§3.12): besök, avbokningar (i tid/auto), no-shows med belopp, ur
// bokningarna — beräknas vid läsning, ingen denormaliserad räknare.
export async function GET(
  request: NextRequest,
  ctx: RouteContext<"/api/restaurants/[slug]/guests/[id]">,
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
  const guest = await prisma.guest.findFirst({
    where: { id, restaurantId: restaurant.id },
    include: { profile: { select: { tags: true, lastVisit: true } } },
  });
  if (!guest) {
    return NextResponse.json({ error: "Okänd kund." }, { status: 404 });
  }

  const bookings = await prisma.booking.findMany({
    where: { guestId: guest.id },
    orderBy: { startsAt: "desc" },
    take: 20,
    select: {
      id: true,
      startsAt: true,
      partySize: true,
      status: true,
      charged: true,
      cancelInfo: true,
    },
  });
  const noShowCount = await prisma.booking.count({
    where: { guestId: guest.id, status: "NO_SHOW" },
  });

  return NextResponse.json({
    tags: guest.profile?.tags ?? [],
    lastVisit: guest.profile?.lastVisit?.toISOString() ?? null,
    noShowCount,
    history: bookings.map((b) => ({
      id: b.id,
      at: b.startsAt.toISOString(),
      partySize: b.partySize,
      status: b.status,
      charged: b.charged === null ? null : Number(b.charged),
      cancelledBy: (b.cancelInfo as { av?: string } | null)?.av ?? null,
    })),
  });
}

// DELETE /api/restaurants/{slug}/guests/{id} — GDPR art 17: hård radering av
// person­uppgifterna. Bokningar är affärshistorik (beläggning) och behålls,
// men anonymiseras genom att pekas om till en "Raderad gäst"-placeholder.
// Mejltrådar raderas helt (innehåller gästens text).
export async function DELETE(
  request: NextRequest,
  ctx: RouteContext<"/api/restaurants/[slug]/guests/[id]">,
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
  const guest = await prisma.guest.findFirst({
    where: { id, restaurantId: restaurant.id },
  });
  if (!guest) {
    return NextResponse.json({ error: "Okänd kund." }, { status: 404 });
  }
  if (guest.name === "Raderad gäst" && !guest.email && !guest.phone) {
    return NextResponse.json(
      { error: "Platshållaren för raderade gäster kan inte raderas." },
      { status: 400 },
    );
  }

  const result = await prisma.$transaction(async (tx) => {
    // Nullbara unika kolumner tillåter många NULL — placeholdern krockar
    // aldrig med @@unique([restaurantId, email/phone])
    let anon = await tx.guest.findFirst({
      where: {
        restaurantId: restaurant.id,
        name: "Raderad gäst",
        email: null,
        phone: null,
      },
    });
    anon ??= await tx.guest.create({
      data: { restaurantId: restaurant.id, name: "Raderad gäst" },
    });
    // Notes/allergier på bokningarna kan innehålla personuppgifter — rensas
    const anonymized = await tx.booking.updateMany({
      where: { guestId: guest.id },
      data: { guestId: anon.id, notes: null, allergyNote: null },
    });
    await tx.emailThread.deleteMany({ where: { guestId: guest.id } });
    // Profil + interaktioner (inkl. embeddings) kaskadraderas via FK
    await tx.guest.delete({ where: { id: guest.id } });
    return anonymized.count;
  });

  return NextResponse.json({ ok: true, anonymizedBookings: result });
}
