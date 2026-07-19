import { redirect } from "next/navigation";
import { prisma } from "@/lib/db/client";
import { getUser } from "@/lib/auth/server";
import { parseRestaurantConfig } from "@/lib/email-concierge/types";
import { getCoreFactsStatus } from "@/lib/restaurant/core-facts";
import { adminTheme } from "@/lib/theme";
import { AssistantClient } from "./assistant-client";

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
    <div data-theme={adminTheme(config).dataTheme}>
      <AssistantClient
        slug={slug}
        restaurantName={restaurant.name}
        initialVoiceAgent={config.voiceAgent}
        coreFacts={facts}
      />
    </div>
  );
}
