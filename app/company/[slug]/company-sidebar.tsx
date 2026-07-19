"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Table02Icon,
  Clock01Icon,
  UserGroupIcon,
  AiMail01Icon,
  Settings01Icon,
} from "@hugeicons/core-free-icons";

const NAV = [
  { href: "floor", label: "Bordskarta", icon: Table02Icon },
  { href: "hours", label: "Öppettider", icon: Clock01Icon },
  { href: "customers", label: "Kunder", icon: UserGroupIcon },
  { href: "inbox", label: "AI-inkorg", icon: AiMail01Icon },
  { href: "settings", label: "Inställningar", icon: Settings01Icon },
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

  return (
    <aside className="w-56 shrink-0 border-r border-line px-3 py-6">
      <p className="px-3 pb-3 text-[11px] uppercase tracking-[0.22em] text-ink-muted">
        Din Restaurang
      </p>
      <nav className="space-y-1">
        {NAV.map((item) => {
          const active = pathname?.endsWith(`/${item.href}`);
          return (
            <Link
              key={item.href}
              href={`/company/${slug}/${item.href}`}
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
        })}
      </nav>
    </aside>
  );
}
