import { notFound } from "next/navigation";
import Link from "next/link";
import { Fraunces } from "next/font/google";
import { prisma } from "@/lib/db/client";
import { getUser } from "@/lib/auth/server";
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

  // Opublicerad: ägaren får förhandsgranska, alla andra ser "Öppnar snart"
  let ownerPreview = false;
  if (!restaurant.published) {
    const user = await getUser();
    ownerPreview =
      restaurant.ownerId !== null && user?.id === restaurant.ownerId;
    if (!ownerPreview) {
      return (
        <div
          className={`${fraunces.variable} flex min-h-dvh flex-col items-center justify-center gap-3 bg-[#0d0d0d] px-6 text-center`}
        >
          <p className="text-[11px] uppercase tracking-[0.22em] text-[#8b9389]">
            Öppnar snart
          </p>
          <h1 className="text-4xl text-[#ede7dc] [font-family:var(--font-display),serif]">
            {restaurant.name}
          </h1>
          <p className="text-sm text-[#8b9389]">
            Bordsbokningen är inte igång ännu — titta förbi snart igen.
          </p>
        </div>
      );
    }
  }

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
      {ownerPreview && (
        <div className="flex items-center justify-center gap-2 bg-[#c89b5a] px-4 py-2 text-center text-xs font-medium text-[#141210]">
          Förhandsvisning — ej publicerad.
          <Link href={`/editor/${slug}`} className="underline underline-offset-2">
            Publicera i editorn
          </Link>
        </div>
      )}
      <BookingWidget
        slug={slug}
        name={restaurant.name}
        openDays={openDays}
        maxParty={config.escalationPartySize}
        menu={config.menu}
        hoursDisplay={hoursDisplay}
        offerings={config.offerings}
        heroImageUrl={config.heroImageUrl}
        logoUrl={config.logoUrl}
      />
    </div>
  );
}
