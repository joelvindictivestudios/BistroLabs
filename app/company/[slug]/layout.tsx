import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import Link from "next/link";
import { prisma } from "@/lib/db/client";
import { getUser } from "@/lib/auth/server";
import { parseRestaurantConfig } from "@/lib/email-concierge/types";
import { adminTheme } from "@/lib/theme";
import { CompanySidebar } from "./company-sidebar";
import { BrandLogo } from "@/app/components/brand-logo";
import { LogoutButton } from "@/app/components/logout-button";

export const metadata = { title: "Din Restaurang — BistroLabs" };

// Adminpanelens skal: toppbar + sidebar. Undersidorna (floor/hours/customers/
// settings/inbox) renderas som children och gör sina egna datainläsningar.
export default async function CompanyLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const user = await getUser();
  if (!user) redirect("/login");

  const { slug } = await params;
  const restaurant = await prisma.restaurant.findUnique({
    where: { slug },
    select: { id: true, name: true, ownerId: true, config: true },
  });
  if (!restaurant || restaurant.ownerId !== user.id) {
    redirect("/create-restaurant");
  }
  const { dataTheme } = adminTheme(parseRestaurantConfig(restaurant.config));

  // Sidofältets badge: antal AI-utkast som väntar på granskning
  const pendingDrafts = await prisma.emailMessage.count({
    where: {
      thread: { restaurantId: restaurant.id },
      direction: "OUTBOUND",
      status: { in: ["DRAFT", "ESCALATED"] },
      handledAt: null,
    },
  });

  return (
    <div
      data-theme={dataTheme}
      className="flex min-h-dvh flex-col bg-app text-ink"
    >
      <header className="flex h-16 shrink-0 items-center gap-4 border-b border-[var(--w-line)] px-6">
        <Link href={`/company/${slug}`} aria-label="Till översikten">
          <BrandLogo />
        </Link>
        <span className="ml-auto text-sm font-semibold tracking-tight [font-family:var(--font-display),sans-serif]">
          {restaurant.name}
        </span>
        <LogoutButton userEmail={user.email ?? ""} />
      </header>

      <div className="flex min-h-0 flex-1">
        <CompanySidebar
          slug={slug}
          initialPendingCount={pendingDrafts}
          initialCollapsed={
            (await cookies()).get("bl-sidebar")?.value === "1"
          }
        />
        <main className="min-w-0 flex-1 overflow-y-auto px-8 py-8">
          {children}
        </main>
      </div>
    </div>
  );
}
