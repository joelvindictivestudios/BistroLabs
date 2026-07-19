import { redirect } from "next/navigation";
import { prisma } from "@/lib/db/client";
import { getUser } from "@/lib/auth/server";
import { CustomersClient } from "./customers-client";

export const metadata = { title: "Kunder — BistroLabs" };

export default async function CustomersPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const user = await getUser();
  if (!user) redirect("/login");

  const { slug } = await params;
  const restaurant = await prisma.restaurant.findUnique({ where: { slug } });
  if (!restaurant || restaurant.ownerId !== user.id) {
    redirect("/create-restaurant");
  }

  const guests = await prisma.guest.findMany({
    where: { restaurantId: restaurant.id },
    orderBy: { createdAt: "desc" },
    take: 50,
    include: {
      profile: {
        select: {
          notes: true,
          lastVisit: true,
          visitCount: true,
          marketingConsent: true,
        },
      },
      // Avbokningar och no-shows räknas inte som bokningar i kundlistan
      _count: {
        select: {
          bookings: { where: { status: { notIn: ["CANCELLED", "NO_SHOW"] } } },
        },
      },
    },
  });

  return (
    <CustomersClient
      slug={slug}
      initialGuests={guests.map((g) => ({
        id: g.id,
        name: g.name,
        email: g.email,
        phone: g.phone,
        notes: g.profile?.notes ?? "",
        bookingCount: g._count.bookings,
        visitCount: g.profile?.visitCount ?? 0,
        marketingConsent: g.profile?.marketingConsent ?? false,
        lastVisit: g.profile?.lastVisit?.toISOString() ?? null,
        createdAt: g.createdAt.toISOString(),
      }))}
    />
  );
}
