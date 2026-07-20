import { redirect } from "next/navigation";
import { prisma } from "@/lib/db/client";
import { getUser } from "@/lib/auth/server";
import { parseRestaurantConfig } from "@/lib/email-concierge/types";
import { SettingsClient } from "./settings-client";

export const metadata = { title: "Inställningar — BistroLabs" };

export default async function SettingsPage({
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
    <SettingsClient
      slug={slug}
      initialName={restaurant.name}
      initialAddress={config.address}
      initialSameDayCutoff={config.sameDayCutoff}
      initialEscalationPartySize={config.escalationPartySize}
      initialTheme={config.theme}
      initialNoShowFeePerGuest={config.noShowFeePerGuest}
      initialCancellationWindowHours={config.cancellationWindowHours}
      initialCardGuaranteeRequired={config.cardGuaranteeRequired}
    />
  );
}
