import { redirect } from "next/navigation";
import { prisma } from "@/lib/db/client";
import { getUser } from "@/lib/auth/server";
import { FloorPlanner } from "../floor-planner";

export const metadata = { title: "Bordskarta — BistroLabs" };

export default async function FloorPage({
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

  return (
    <div className="mx-auto max-w-3xl">
      <FloorPlanner
        slug={slug}
        initialRooms={restaurant.rooms.map((r) => ({ id: r.id, name: r.name }))}
        initialTables={restaurant.tables.map((t) => ({
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
