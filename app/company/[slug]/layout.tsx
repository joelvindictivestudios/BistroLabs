import { redirect } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { Plus_Jakarta_Sans } from "next/font/google";
import { prisma } from "@/lib/db/client";
import { getUser } from "@/lib/auth/server";
import { CompanySidebar } from "./company-sidebar";

const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  variable: "--font-display",
  weight: ["400", "600", "700"],
});

export const metadata = { title: "Din Restaurang — BistroLabs" };

// Adminpanelens skal: toppbar + sidebar. Undersidorna (floor/hours/customers/
// settings) renderas som children och gör sina egna datainläsningar.
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
    select: { name: true, ownerId: true },
  });
  if (!restaurant || restaurant.ownerId !== user.id) {
    redirect("/create-restaurant");
  }

  return (
    <div
      className={`${jakarta.variable} flex min-h-dvh flex-col bg-[var(--w-bg)] text-[var(--w-ink)]`}
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
      <header className="flex h-16 shrink-0 items-center gap-4 border-b border-[var(--w-line)] px-6">
        <Link href={`/dashboard/${slug}`} aria-label="Till översikten">
          <Image
            src="/BLWhiteSide.png"
            alt="BistroLabs"
            width={138}
            height={30}
            className="h-7 w-auto"
          />
        </Link>
        <Link
          href={`/dashboard/${slug}`}
          className="mt-2 text-xs text-[var(--w-muted)] hover:text-[var(--w-ink)] transition-colors"
        >
          ‹ Översikt
        </Link>
        <span className="ml-auto text-sm font-semibold tracking-tight [font-family:var(--font-display),sans-serif]">
          {restaurant.name}
        </span>
      </header>

      <div className="flex min-h-0 flex-1">
        <CompanySidebar slug={slug} />
        <main className="min-w-0 flex-1 overflow-y-auto px-8 py-8">
          {children}
        </main>
      </div>
    </div>
  );
}
