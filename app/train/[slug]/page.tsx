import { redirect } from "next/navigation";
import { prisma } from "@/lib/db/client";
import { getUser } from "@/lib/auth/server";
import { parseRestaurantConfig } from "@/lib/email-concierge/types";
import { adminTheme } from "@/lib/theme";
import { TrainClient } from "./train-client";

export const metadata = { title: "Träna din AI — BistroLabs" };

const POLICY_TITLES = ["Avbokningspolicy", "Allergihantering"] as const;

export default async function TrainPage({
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

  const documents = await prisma.knowledgeDocument.findMany({
    where: { restaurantId: restaurant.id },
    orderBy: { createdAt: "desc" },
    select: { id: true, category: true, title: true, createdAt: true },
  });

  const policies = Object.fromEntries(
    await Promise.all(
      POLICY_TITLES.map(async (title) => {
        const doc = await prisma.knowledgeDocument.findFirst({
          where: { restaurantId: restaurant.id, category: "policy", title },
        });
        return [title, doc?.content ?? ""] as const;
      }),
    ),
  );

  return (
    <div
      data-theme={
        adminTheme(parseRestaurantConfig(restaurant.config)).dataTheme
      }
    >
      <TrainClient
        slug={slug}
        name={restaurant.name}
        initialPolicies={policies}
        initialDocuments={documents.map((d) => ({
          id: d.id,
          category: d.category,
          title: d.title,
        }))}
      />
    </div>
  );
}
