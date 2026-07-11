import { redirect } from "next/navigation";
import { prisma } from "@/lib/db/client";
import { getUser } from "@/lib/auth/server";
import { parseRestaurantConfig } from "@/lib/email-concierge/types";
import { HoursClient } from "./hours-client";

export const metadata = { title: "Öppettider — BistroLabs" };

export default async function HoursPage({
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

  const config = parseRestaurantConfig(restaurant.config);
  return (
    <HoursClient
      slug={slug}
      initialConfig={{
        openingHours: config.openingHours,
        closedDates: config.closedDates,
        bookingStopDates: config.bookingStopDates,
      }}
    />
  );
}
