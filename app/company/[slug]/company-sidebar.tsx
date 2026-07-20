"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  DashboardSquare01Icon,
  Calendar03Icon,
  UserGroupIcon,
  ChartHistogramIcon,
  Table02Icon,
  Clock01Icon,
  AiMail01Icon,
  Settings01Icon,
  PaintBoardIcon,
  AiChat01Icon,
  Mortarboard01Icon,
  LinkSquare01Icon,
} from "@hugeicons/core-free-icons";

// Adminpanelens navigation (POC:ns struktur): Översikt är hemvyn, arbets-
// ytorna är egna poster, och produktverktygen ligger i en egen grupp.
// "Widget" är ENDAST en länk till den befintliga editor-routen — editorn
// själv är oförändrad.

type NavItem = {
  /** Relativ path under /company/[slug], "" = Översikt, eller absolut ("/..."). */
  href: string;
  label: string;
  icon: typeof Table02Icon;
};

const MAIN: readonly NavItem[] = [
  { href: "", label: "Översikt", icon: DashboardSquare01Icon },
  { href: "/bookings", label: "Bokningar", icon: Calendar03Icon },
  { href: "customers", label: "Gäster", icon: UserGroupIcon },
  { href: "rapporter", label: "Rapporter", icon: ChartHistogramIcon },
  { href: "floor", label: "Bordskarta", icon: Table02Icon },
  { href: "hours", label: "Öppettider", icon: Clock01Icon },
  { href: "inbox", label: "AI-inkorg", icon: AiMail01Icon },
  { href: "settings", label: "Inställningar", icon: Settings01Icon },
] as const;

const TOOLS: readonly NavItem[] = [
  { href: "/editor", label: "Widget", icon: PaintBoardIcon },
  { href: "/assistant", label: "Assistent", icon: AiChat01Icon },
  { href: "/train", label: "Träna din AI", icon: Mortarboard01Icon },
] as const;

export function CompanySidebar({
  slug,
  initialPendingCount,
}: {
  slug: string;
  initialPendingCount: number;
}) {
  const pathname = usePathname();
  const [pending, setPending] = useState(initialPendingCount);

  // Badge hålls färsk: poll vid fönsterfokus + var 60:e sekund
  useEffect(() => {
    let alive = true;
    const refresh = async () => {
      try {
        const res = await fetch(`/api/restaurants/${slug}/inbox?counts=1`);
        if (!res.ok) return;
        const data = (await res.json()) as {
          counts?: { pending?: number };
        };
        if (alive && typeof data.counts?.pending === "number") {
          setPending(data.counts.pending);
        }
      } catch {
        // badge är best-effort
      }
    };
    const interval = setInterval(refresh, 60_000);
    window.addEventListener("focus", refresh);
    return () => {
      alive = false;
      clearInterval(interval);
      window.removeEventListener("focus", refresh);
    };
  }, [slug]);

  const hrefFor = (item: NavItem) =>
    item.href.startsWith("/")
      ? `${item.href}/${slug}`
      : item.href === ""
        ? `/company/${slug}`
        : `/company/${slug}/${item.href}`;

  const isActive = (item: NavItem) => {
    if (item.href === "") return pathname === `/company/${slug}`;
    if (item.href.startsWith("/")) return pathname?.startsWith(item.href);
    return pathname?.endsWith(`/${item.href}`);
  };

  const renderItem = (item: NavItem) => {
    const active = isActive(item);
    return (
      <Link
        key={item.label}
        href={hrefFor(item)}
        aria-current={active ? "page" : undefined}
        className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors motion-safe:duration-150 ${
          active
            ? "bg-accent/10 text-accent"
            : "text-ink-muted hover:bg-panel hover:text-ink"
        }`}
      >
        <HugeiconsIcon icon={item.icon} size={19} strokeWidth={1.6} />
        {item.label}
        {item.href === "inbox" && pending > 0 && (
          <span className="ml-auto rounded-pill bg-accent px-2 py-0.5 text-[11px] font-bold text-accent-on">
            {pending}
          </span>
        )}
      </Link>
    );
  };

  return (
    <aside className="flex w-56 shrink-0 flex-col border-r border-line px-3 py-6">
      <nav className="space-y-1">{MAIN.map(renderItem)}</nav>

      <p className="px-3 pb-2 pt-6 text-[11px] uppercase tracking-[0.22em] text-ink-muted">
        Verktyg
      </p>
      <nav className="space-y-1">{TOOLS.map(renderItem)}</nav>

      <a
        href={`/widget/${slug}`}
        target="_blank"
        rel="noreferrer"
        className="mt-auto flex items-center gap-3 rounded-xl border border-line px-3 py-2.5 text-sm text-ink-muted transition-colors hover:border-accent hover:text-ink motion-safe:duration-150"
      >
        <HugeiconsIcon icon={LinkSquare01Icon} size={18} strokeWidth={1.6} />
        Förhandsgranska gästvy
      </a>
    </aside>
  );
}
