import { prisma } from "../db/client";

export type GuestInput = {
  name?: string;
  email?: string;
  phone?: string;
  notes?: string;
};

/**
 * Hitta befintlig gäst på e-post eller telefon, annars skapa.
 * Delas av widget-bokningen, personalens "Ny bokning" och CSV-importen.
 * `created` skiljer nyskapad från sammanslagen (importens summering).
 */
export async function findOrCreateGuest(
  restaurantId: string,
  data: GuestInput,
): Promise<{ guest: { id: string; name: string | null; email: string | null; phone: string | null }; created: boolean }> {
  const existing = await prisma.guest.findFirst({
    where: {
      restaurantId,
      OR: [
        ...(data.email ? [{ email: data.email }] : []),
        ...(data.phone ? [{ phone: data.phone }] : []),
      ],
    },
  });
  if (existing) {
    // Komplettera tomma fält — skriv aldrig över befintliga uppgifter
    await prisma.guest.update({
      where: { id: existing.id },
      data: {
        ...(data.name && !existing.name ? { name: data.name } : {}),
        ...(data.email && !existing.email ? { email: data.email } : {}),
        ...(data.phone && !existing.phone ? { phone: data.phone } : {}),
      },
    });
    if (data.notes?.trim()) {
      // Sätt bara profilanteckning om ingen finns — samma filosofi som ovan
      await prisma.guestProfile.upsert({
        where: { guestId: existing.id },
        update: {},
        create: { guestId: existing.id, notes: data.notes.trim() },
      });
    }
    return { guest: existing, created: false };
  }
  const guest = await prisma.guest.create({
    data: {
      restaurantId,
      name: data.name || null,
      email: data.email || null,
      phone: data.phone || null,
    },
  });
  if (data.notes?.trim()) {
    await prisma.guestProfile.create({
      data: { guestId: guest.id, notes: data.notes.trim() },
    });
  }
  return { guest, created: true };
}
