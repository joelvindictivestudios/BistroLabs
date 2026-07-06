import { redirect } from "next/navigation";
import { Plus_Jakarta_Sans } from "next/font/google";
import { prisma } from "@/lib/db/client";
import { getUser } from "@/lib/auth/server";
import { parseRestaurantConfig } from "@/lib/email-concierge/types";
import { TrainClient } from "./train-client";

const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  variable: "--font-display",
  weight: ["400", "600", "700"],
});

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
  const restaurant = await prisma.restaurant.findUnique({
    where: { slug },
    include: { tables: true },
  });
  if (!restaurant || restaurant.ownerId !== user.id) {
    redirect("/create-restaurant");
  }

  const config = parseRestaurantConfig(restaurant.config);
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

  const bookingCount = await prisma.booking.count({
    where: { restaurantId: restaurant.id },
  });

  return (
    <div className={jakarta.variable}>
      <TrainClient
        slug={slug}
        initialName={restaurant.name}
        initialConfig={config}
        initialTables={{
          two: restaurant.tables.filter((t) => t.capacity === 2).length,
          four: restaurant.tables.filter((t) => t.capacity === 4).length,
          six: restaurant.tables.filter((t) => t.capacity === 6).length,
        }}
        tablesLocked={bookingCount > 0}
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
