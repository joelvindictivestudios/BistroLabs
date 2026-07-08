import { redirect } from "next/navigation";
import { Plus_Jakarta_Sans } from "next/font/google";
import { prisma } from "@/lib/db/client";
import { getUser } from "@/lib/auth/server";
import { parseRestaurantConfig } from "@/lib/email-concierge/types";
import { BookingsClient } from "./bookings-client";

const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  variable: "--font-display",
  weight: ["400", "600", "700"],
});

export const metadata = { title: "Bokningar — BistroLabs" };

export default async function BookingsPage({
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
    <div className={jakarta.variable}>
      <BookingsClient
        slug={slug}
        restaurantId={restaurant.id}
        restaurantName={restaurant.name}
        openingHours={config.openingHours}
      />
    </div>
  );
}
