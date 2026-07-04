import { redirect } from "next/navigation";
import { Fraunces, Plus_Jakarta_Sans } from "next/font/google";
import { prisma } from "@/lib/db/client";
import { getUser } from "@/lib/auth/server";
import { parseRestaurantConfig } from "@/lib/email-concierge/types";
import { EditorClient } from "./editor-client";

// Admin-chromet sätts i Jakarta; preview-ytan får Fraunces scoped på sig
// så widgeten ser ut exakt som den gör publikt.
const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  variable: "--font-display",
  weight: ["400", "600", "700"],
});
const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--font-display",
  weight: ["400", "500", "600"],
});

export const metadata = { title: "Widget-editor — BistroLabs" };

export default async function EditorPage({
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
  const bookingCount = await prisma.booking.count({
    where: { restaurantId: restaurant.id },
  });
  const tables = {
    two: restaurant.tables.filter((t) => t.capacity === 2).length,
    four: restaurant.tables.filter((t) => t.capacity === 4).length,
    six: restaurant.tables.filter((t) => t.capacity === 6).length,
  };

  return (
    <div className={jakarta.variable}>
      <EditorClient
        slug={restaurant.slug}
        initialName={restaurant.name}
        initialPublished={restaurant.published}
        initialConfig={config}
        initialTables={tables}
        tablesLocked={bookingCount > 0}
        userEmail={user.email ?? ""}
        previewFontClass={fraunces.variable}
      />
    </div>
  );
}
