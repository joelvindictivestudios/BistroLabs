import { notFound } from "next/navigation";
import { Fraunces } from "next/font/google";
import { prisma } from "@/lib/db/client";
import { parseRestaurantConfig } from "@/lib/email-concierge/types";
import { BookingWidget } from "./booking-widget";

const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--font-display",
  weight: ["400", "500", "600"],
});

const WEEKDAY_LABELS: Record<string, string> = {
  mon: "Måndag",
  tue: "Tisdag",
  wed: "Onsdag",
  thu: "Torsdag",
  fri: "Fredag",
  sat: "Lördag",
  sun: "Söndag",
};

export default async function WidgetPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const restaurant = await prisma.restaurant.findUnique({ where: { slug } });
  if (!restaurant) notFound();

  const config = parseRestaurantConfig(restaurant.config);
  const openDays = Object.entries(config.openingHours)
    .filter(([, ranges]) => ranges.length > 0)
    .map(([day]) => day);
  const hoursDisplay = Object.keys(WEEKDAY_LABELS)
    .filter((day) => openDays.includes(day))
    .map((day) => ({
      day: WEEKDAY_LABELS[day],
      hours: (config.openingHours[day] ?? [])
        .map((r) => `${r.open}–${r.close}`)
        .join(", "),
    }));

  return (
    <div className={fraunces.variable}>
      <BookingWidget
        slug={slug}
        name={restaurant.name}
        openDays={openDays}
        maxParty={config.escalationPartySize}
        menu={config.menu}
        hoursDisplay={hoursDisplay}
        offerings={config.offerings}
        heroImageUrl={config.heroImageUrl}
      />
    </div>
  );
}
