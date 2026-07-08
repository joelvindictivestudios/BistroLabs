import { redirect } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { Plus_Jakarta_Sans } from "next/font/google";
import { prisma } from "@/lib/db/client";
import { getUser } from "@/lib/auth/server";

const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  variable: "--font-display",
  weight: ["400", "600", "700"],
});

export const metadata = { title: "Bokningar — BistroLabs" };

const STATUS_LABELS: Record<string, { label: string; classes: string }> = {
  PENDING: {
    label: "Väntar",
    classes: "border-yellow-500/40 bg-yellow-500/10 text-yellow-400",
  },
  CONFIRMED: {
    label: "Bekräftad",
    classes: "border-emerald-500/40 bg-emerald-500/10 text-emerald-400",
  },
  CANCELLED: {
    label: "Avbokad",
    classes: "border-[var(--w-line)] bg-[var(--w-panel)] text-[var(--w-muted)]",
  },
  COMPLETED: {
    label: "Genomförd",
    classes: "border-[var(--w-line)] bg-[var(--w-panel)] text-[var(--w-muted)]",
  },
  NO_SHOW: {
    label: "Utebliven",
    classes: "border-red-500/40 bg-red-500/10 text-red-400",
  },
};

export default async function BookingsPage({
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

  const bookings = await prisma.booking.findMany({
    where: { restaurantId: restaurant.id },
    orderBy: { startsAt: "desc" },
    take: 100,
    include: {
      guest: { select: { name: true, email: true, phone: true } },
      table: { select: { name: true } },
    },
  });

  const formatTime = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Stockholm",
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <div
      className={`${jakarta.variable} min-h-dvh bg-[var(--w-bg)] text-[var(--w-ink)]`}
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
      <header className="flex h-16 items-center gap-4 border-b border-[var(--w-line)] px-6">
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
          className="text-xs mt-2 text-[var(--w-muted)] hover:text-[var(--w-ink)] transition-colors"
        >
          ‹ Översikt
        </Link>
      </header>

      <main className="mx-auto max-w-4xl px-6 py-10">
        <p className="text-[11px] uppercase tracking-[0.22em] text-[var(--w-muted)]">
          Bokningar
        </p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight [font-family:var(--font-display),sans-serif]">
          {restaurant.name}
        </h1>

        {bookings.length === 0 ? (
          <p className="mt-10 text-sm text-[var(--w-muted)]">
            Inga bokningar ännu — de dyker upp här så fort gäster bokar via
            widgeten eller assistenten.
          </p>
        ) : (
          <div className="mt-8 overflow-x-auto rounded-2xl border border-[var(--w-line)]">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--w-line)] text-left text-[11px] uppercase tracking-wider text-[var(--w-muted)]">
                  <th className="px-4 py-3 font-medium">Tid</th>
                  <th className="px-4 py-3 font-medium">Gäst</th>
                  <th className="px-4 py-3 font-medium">Sällskap</th>
                  <th className="px-4 py-3 font-medium">Bord</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Via</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--w-line)]">
                {bookings.map((b) => {
                  const status = STATUS_LABELS[b.status] ?? {
                    label: b.status,
                    classes:
                      "border-[var(--w-line)] bg-[var(--w-panel)] text-[var(--w-muted)]",
                  };
                  return (
                    <tr key={b.id} className="hover:bg-[var(--w-panel)]/60">
                      <td className="px-4 py-3 font-mono text-xs">
                        {formatTime.format(b.startsAt)}
                      </td>
                      <td className="px-4 py-3">
                        {b.guest.name ?? b.guest.email ?? b.guest.phone ?? "—"}
                      </td>
                      <td className="px-4 py-3">{b.partySize} pers</td>
                      <td className="px-4 py-3">{b.table?.name ?? "—"}</td>
                      <td className="px-4 py-3">
                        <span
                          className={`rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${status.classes}`}
                        >
                          {status.label}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-[var(--w-muted)]">
                        {b.createdBy === "widget"
                          ? "Widget"
                          : b.createdBy === "concierge"
                            ? "AI-assistent"
                            : b.createdBy}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  );
}
