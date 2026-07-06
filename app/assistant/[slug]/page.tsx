import { redirect } from "next/navigation";
import { Plus_Jakarta_Sans } from "next/font/google";
import { prisma } from "@/lib/db/client";
import { getUser } from "@/lib/auth/server";
import { parseRestaurantConfig } from "@/lib/email-concierge/types";
import { getCoreFactsStatus } from "@/lib/restaurant/core-facts";
import { AssistantClient } from "./assistant-client";

const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  variable: "--font-display",
  weight: ["400", "600", "700"],
});

export const metadata = { title: "Bokningsassistent — BistroLabs" };

export default async function AssistantPage({
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
  const facts = await getCoreFactsStatus(restaurant.id, config);

  return (
    <div className={jakarta.variable}>
      <AssistantClient
        slug={slug}
        restaurantName={restaurant.name}
        initialVoiceAgent={config.voiceAgent}
        coreFacts={facts}
      />
    </div>
  );
}
