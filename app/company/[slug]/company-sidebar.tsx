"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Table02Icon,
  Clock01Icon,
  UserGroupIcon,
  Settings01Icon,
} from "@hugeicons/core-free-icons";

const NAV = [
  { href: "floor", label: "Bordskarta", icon: Table02Icon },
  { href: "hours", label: "Öppettider", icon: Clock01Icon },
  { href: "customers", label: "Kunder", icon: UserGroupIcon },
  { href: "settings", label: "Inställningar", icon: Settings01Icon },
] as const;

export function CompanySidebar({ slug }: { slug: string }) {
  const pathname = usePathname();

  return (
    <aside className="w-56 shrink-0 border-r border-[var(--w-line)] px-3 py-6">
      <p className="px-3 pb-3 text-[11px] uppercase tracking-[0.22em] text-[var(--w-muted)]">
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
                  ? "bg-[var(--w-accent)]/10 text-[var(--w-accent)]"
                  : "text-[var(--w-muted)] hover:bg-[var(--w-panel)] hover:text-[var(--w-ink)]"
              }`}
            >
              <HugeiconsIcon icon={item.icon} size={19} strokeWidth={1.6} />
              {item.label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
