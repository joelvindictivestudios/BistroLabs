import { redirect } from "next/navigation";
import { Plus_Jakarta_Sans } from "next/font/google";
import { prisma } from "@/lib/db/client";
import { getUser } from "@/lib/auth/server";
import { parseRestaurantConfig } from "@/lib/email-concierge/types";
import { CompanyClient } from "./company-client";

const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  variable: "--font-display",
  weight: ["400", "600", "700"],
});

export const metadata = { title: "Ditt företag — BistroLabs" };

export default async function CompanyPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const user = await getUser();
  if (!user) redirect("/login");

  const { slug } = await params;
  const restaurant = await prisma.restaurant.findUnique({
    where: { slug },
    include: {
      rooms: { orderBy: { sortOrder: "asc" } },
      tables: {
        orderBy: { name: "asc" },
        include: { _count: { select: { bookings: true } } },
      },
    },
  });
  if (!restaurant || restaurant.ownerId !== user.id) {
    redirect("/create-restaurant");
  }

  const config = parseRestaurantConfig(restaurant.config);

  return (
    <div className={jakarta.variable}>
      <CompanyClient
        slug={slug}
        initialName={restaurant.name}
        initialConfig={config}
        initialRooms={restaurant.rooms.map((r) => ({ id: r.id, name: r.name }))}
        initialFloorTables={restaurant.tables.map((t) => ({
          id: t.id,
          roomId: t.roomId,
          name: t.name,
          capacity: t.capacity,
          minSeats: t.minSeats,
          shape: t.shape,
          posX: t.posX,
          posY: t.posY,
          bookingCount: t._count.bookings,
        }))}
      />
    </div>
  );
}
