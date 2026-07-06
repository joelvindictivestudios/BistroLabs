import { redirect } from "next/navigation";
import Image from "next/image";
import { Plus_Jakarta_Sans } from "next/font/google";
import { prisma } from "@/lib/db/client";
import { getUser } from "@/lib/auth/server";
import { parseRestaurantConfig } from "@/lib/email-concierge/types";
import { getCompanyInfoStatus } from "@/lib/restaurant/core-facts";
import SideRays from "@/app/components/SideRays";
import { LogoutButton } from "./logout-button";
import { ModuleCard } from "./module-card";

const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  variable: "--font-display",
  weight: ["400", "600", "700"],
});

export const metadata = { title: "Översikt — BistroLabs" };

export default async function DashboardPage({
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
  const companyInfo = await getCompanyInfoStatus(restaurant, config);

  const modules = [
    {
      href: `/company/${slug}`,
      title: "Din Restaurang",
      icon: "/businessicon.png",
      description:
        "Grundläggande uppgifter — namn, adress, öppettider och bordskapacitet.",
    },
    {
      href: `/editor/${slug}`,
      title: "Widget",
      icon: "/editorIcon.png",
      description:
        "Bokningssidan dina gäster möter — design, sittningar, bilder och publicering.",
    },
    {
      href: `/assistant/${slug}`,
      title: "Bokningsassistent",
      icon: "/bookingass.png",
      description:
        "AI:n som svarar i telefon — röst, hälsningsfras och ett eget telefonnummer.",
    },
    {
      href: `/train/${slug}`,
      title: "Träna din AI",
      icon: "/trainAIIcon.png",
      description: companyInfo.complete
        ? "Policyer och dokument — kunskapen som delas av widgeten, mejlen och telefonen."
        : "Besvara alla frågor i Ditt företag för att låsa upp",
      locked: !companyInfo.complete,
    },
  ];

  return (
    <div
      className={`${jakarta.variable} relative min-h-dvh overflow-hidden bg-[var(--w-bg)] text-[var(--w-ink)]`}
      style={
        {
          "--w-bg": "#101312",
          "--w-panel": "#161b19",
          "--w-line": "#2a312d",
          "--w-ink": "#ede7dc",
          "--w-muted": "#8b9389",
          "--w-accent": "#c89b5a",
        } as React.CSSProperties
      }
    >
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <SideRays
          speed={1.5}
          rayColor1="#c89b5a"
          rayColor2="#96c8ff"
          intensity={2}
          spread={2}
          origin="top-right"
          tilt={0}
          saturation={1.5}
          blend={0.75}
          falloff={1.6}
          opacity={0.5}
        />
      </div>

      <header className="relative z-10 flex h-16 items-center justify-between border-b border-[var(--w-line)] px-6">
        <Image
          src="/BLWhiteSide.png"
          alt="BistroLabs"
          width={138}
          height={30}
          className="h-7 w-auto"
        />
        <LogoutButton userEmail={user.email ?? ""} />
      </header>

      <main className="relative z-10 mx-auto max-w-4xl px-6 py-12">
        <p className="text-[11px] uppercase tracking-[0.22em] text-[var(--w-muted)]">
          Översikt
        </p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight [font-family:var(--font-display),sans-serif]">
          {restaurant.name}
        </h1>

        <div className="mt-10 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {modules.map((m) => (
            <ModuleCard key={m.href} {...m} />
          ))}
        </div>
      </main>
    </div>
  );
}
