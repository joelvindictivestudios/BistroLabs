import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/client";
import { getUser } from "@/lib/auth/server";

const patchGuestSchema = z.object({
  name: z.string().max(120).nullable().optional(),
  email: z.email().nullable().optional(),
  phone: z.string().min(5).max(30).nullable().optional(),
  notes: z.string().max(1000).optional(),
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

  if (body.notes !== undefined) {
    await prisma.guestProfile.upsert({
      where: { guestId: guest.id },
      update: { notes: body.notes.trim() || null },
      create: { guestId: guest.id, notes: body.notes.trim() || null },
    });
  }

  return NextResponse.json({ ok: true });
}
