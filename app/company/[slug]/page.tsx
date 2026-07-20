import { redirect } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/db/client";
import { getUser } from "@/lib/auth/server";
import { parseRestaurantConfig } from "@/lib/email-concierge/types";
import { localToUtc } from "@/lib/booking/availability";
import { Avatar } from "@/app/components/avatar";

export const metadata = { title: "Översikt — BistroLabs" };

// Översikten (POC:ns dashboard-struktur): kvällens läge på en blick.
// Signaturen är kvällens kurva — gäster per timme med en "nu"-markör,
// det en värd faktiskt sneglar på mitt under service. Rapporterna över
// tid bor på /company/[slug]/rapporter; verktygen nås via sidomenyn.

const ACTIVE_STATUSES = ["PENDING", "CONFIRMED", "SEATED", "COMPLETED"] as const;

const STATUS_PILLS: Record<string, { label: string; className: string }> = {
  PENDING: {
    label: "Preliminär",
    className: "bg-status-pending-bg text-status-pending-fg",
  },
  CONFIRMED: {
    label: "Bekräftad",
    className: "bg-status-booked-bg text-status-booked-fg",
  },
  SEATED: {
    label: "Sitter",
    className: "bg-status-seated-bg text-status-seated-fg",
  },
};

const SOURCE_LABELS: Record<string, string> = {
  widget: "Widget",
  concierge: "AI-mejl",
  dropin: "Drop-in",
  human: "Manuell",
};

export default async function OverviewPage({
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

  // --- Dagens data, allt i restaurangens tidszon ---
  const today = new Intl.DateTimeFormat("sv-SE", {
    timeZone: config.timezone,
  }).format(new Date()); // "YYYY-MM-DD"
  const dayStart = localToUtc(today, "00:00", config.timezone);
  const dayEnd = new Date(dayStart.getTime() + 24 * 3600_000);

  const [todaysBookings, tables, waitingCount] = await Promise.all([
    prisma.booking.findMany({
      where: {
        restaurantId: restaurant.id,
        startsAt: { gte: dayStart, lt: dayEnd },
      },
      orderBy: { startsAt: "asc" },
      include: {
        guest: { select: { name: true, email: true, phone: true } },
        table: { select: { name: true } },
      },
    }),
    prisma.diningTable.findMany({
      where: { restaurantId: restaurant.id },
      select: { capacity: true },
    }),
    prisma.waitlistEntry.count({
      where: { restaurantId: restaurant.id, date: today, status: "WAITING" },
    }),
  ]);

  const active = todaysBookings.filter((b) =>
    (ACTIVE_STATUSES as readonly string[]).includes(b.status),
  );
  const guestsTonight = active.reduce((sum, b) => sum + b.partySize, 0);
  const seatedNow = todaysBookings
    .filter((b) => b.status === "SEATED")
    .reduce((sum, b) => sum + (b.arrivedCount ?? b.partySize), 0);
  const noshowCount = todaysBookings.filter(
    (b) => b.status === "NO_SHOW",
  ).length;
  const totalSeats = tables.reduce((sum, t) => sum + t.capacity, 0);
  const occupancyPct =
    totalSeats > 0
      ? Math.min(100, Math.round((guestsTonight / totalSeats) * 100))
      : 0;

  const kpis = [
    {
      label: "Bokningar idag",
      value: String(active.length),
      delta: "via widget & manuellt",
      deltaClass: "text-ink-faint",
    },
    {
      label: "Gäster ikväll",
      value: String(guestsTonight),
      delta: `${seatedNow} sitter just nu`,
      deltaClass: "text-status-seated-fg",
    },
    {
      label: "Beläggning",
      value: `${occupancyPct}%`,
      delta: `av ${totalSeats} platser`,
      deltaClass: "text-ink-faint",
    },
    {
      label: "No-shows",
      value: String(noshowCount),
      delta: noshowCount === 0 ? "inga idag" : "idag",
      deltaClass: noshowCount === 0 ? "text-ink-faint" : "text-status-late-fg",
    },
  ];

  // --- Kvällens kurva: gäster per timme + nu-markör ---
  const hourFmt = new Intl.DateTimeFormat("sv-SE", {
    timeZone: config.timezone,
    hour: "2-digit",
    hour12: false,
  });
  const byHour = new Map<number, number>();
  for (const b of active) {
    const hour = Number(hourFmt.format(b.startsAt));
    byHour.set(hour, (byHour.get(hour) ?? 0) + b.partySize);
  }
  const hoursSorted = [...byHour.keys()].sort((a, b) => a - b);
  const hourBars =
    hoursSorted.length > 0
      ? (() => {
          const from = hoursSorted[0];
          const to = hoursSorted[hoursSorted.length - 1];
          const max = Math.max(...byHour.values());
          const bars = [];
          for (let h = from; h <= to; h++) {
            const val = byHour.get(h) ?? 0;
            bars.push({
              hour: `${String(h).padStart(2, "0")}`,
              val,
              pct: max > 0 ? Math.max(4, Math.round((val / max) * 100)) : 4,
              peak: val === max && max > 0,
            });
          }
          return bars;
        })()
      : [];

  // Nu-markören: position över stapelraden, endast när "nu" ligger inom
  // kurvans tidsspann (beräknas vid rendering, i restaurangens tidszon)
  const nowParts = new Intl.DateTimeFormat("sv-SE", {
    timeZone: config.timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const nowHour = Number(nowParts.find((p) => p.type === "hour")?.value ?? 0);
  const nowMinute = Number(
    nowParts.find((p) => p.type === "minute")?.value ?? 0,
  );
  const nowMin = nowHour * 60 + nowMinute;
  let nowMarker: { leftPct: number; label: string } | null = null;
  if (hoursSorted.length > 0) {
    const spanStart = hoursSorted[0] * 60;
    const spanEnd = (hoursSorted[hoursSorted.length - 1] + 1) * 60;
    if (nowMin >= spanStart && nowMin <= spanEnd) {
      nowMarker = {
        leftPct: ((nowMin - spanStart) / (spanEnd - spanStart)) * 100,
        label: `Nu ${String(nowHour).padStart(2, "0")}:${String(nowMinute).padStart(2, "0")}`,
      };
    }
  }

  // --- Nästa ankomster, tidsgrupperade (POC:ns avdelare) ---
  const now = new Date();
  const timeFmt = new Intl.DateTimeFormat("sv-SE", {
    timeZone: config.timezone,
    hour: "2-digit",
    minute: "2-digit",
  });
  const upcoming = active
    .filter(
      (b) =>
        (b.status === "PENDING" || b.status === "CONFIRMED") && b.endsAt > now,
    )
    .slice(0, 8);
  const groups: { time: string; items: typeof upcoming }[] = [];
  for (const b of upcoming) {
    const t = timeFmt.format(b.startsAt);
    const last = groups[groups.length - 1];
    if (last && last.time === t) last.items.push(b);
    else groups.push({ time: t, items: [b] });
  }

  const dateLabel = new Intl.DateTimeFormat("sv-SE", {
    timeZone: config.timezone,
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date());

  return (
    <div className="mx-auto max-w-5xl">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight [font-family:var(--font-display),sans-serif]">
            Översikt
          </h1>
          <p className="mt-1 text-sm capitalize text-[var(--w-muted)]">
            {dateLabel}
          </p>
        </div>
        <Link
          href={`/bookings/${slug}`}
          className="rounded-xl bg-[var(--w-accent)] px-4 py-2.5 text-sm font-semibold text-accent-on shadow-lg shadow-black/25 hover:brightness-110 transition"
        >
          Öppna bokningsvyn
        </Link>
      </div>

      {/* Smal KPI-rad */}
      <div className="mt-6 grid gap-3 md:grid-cols-2 lg:grid-cols-4">
        {kpis.map((k) => (
          <div
            key={k.label}
            className="rounded-card border border-line-card bg-card px-4 py-3.5 shadow-card"
          >
            <p className="text-[12px] font-semibold text-ink-faint">
              {k.label}
            </p>
            <div className="mt-1 flex items-baseline justify-between gap-2">
              <p className="text-2xl font-bold leading-none tracking-tight">
                {k.value}
              </p>
              <p className={`text-[11.5px] font-semibold ${k.deltaClass}`}>
                {k.delta}
              </p>
            </div>
          </div>
        ))}
      </div>

      {/* Hjälten: kvällens kurva + beläggning */}
      <div className="mt-4 grid gap-4 lg:grid-cols-[1.6fr_1fr]">
        <div className="rounded-card border border-line-card bg-card p-6 shadow-card">
          <p className="text-[15px] font-bold">Kvällens kurva</p>
          <p className="mt-0.5 text-[13px] text-ink-faint">
            Bokade gäster per timme
          </p>
          {hourBars.length > 0 ? (
            <div className="relative mt-6">
              <div className="flex h-44 items-end gap-3.5">
                {hourBars.map((b) => (
                  <div
                    key={b.hour}
                    className="flex h-full flex-1 flex-col items-center justify-end gap-2"
                  >
                    <span className="text-xs font-bold text-ink-muted">
                      {b.val}
                    </span>
                    <div
                      className={`w-full rounded-t-[7px] ${
                        b.peak ? "bg-accent" : "bg-accent/45"
                      }`}
                      style={{ height: `${b.pct}%` }}
                    />
                    <span className="text-xs text-ink-faint">{b.hour}</span>
                  </div>
                ))}
              </div>
              {nowMarker && (
                <div
                  aria-hidden
                  className="pointer-events-none absolute inset-y-0"
                  style={{ left: `${nowMarker.leftPct}%` }}
                >
                  <div className="absolute inset-y-5 w-px bg-[var(--w-ink)]/35" />
                  <span className="absolute -top-0.5 -translate-x-1/2 whitespace-nowrap rounded-pill border border-line bg-panel px-2 py-0.5 text-[10px] font-bold text-ink-muted">
                    {nowMarker.label}
                  </span>
                </div>
              )}
            </div>
          ) : (
            <p className="mt-6 text-sm text-ink-faint">
              Inga bokningar idag ännu — kurvan ritas när första bokningen
              kommer in.
            </p>
          )}
        </div>

        <div className="flex flex-col items-center rounded-card border border-line-card bg-card p-6 shadow-card">
          <p className="self-start text-[15px] font-bold">Beläggning ikväll</p>
          <div
            className="my-4 flex h-[138px] w-[138px] items-center justify-center rounded-full"
            style={{
              background: `conic-gradient(var(--accent) ${occupancyPct * 3.6}deg, var(--bg-hover) 0deg)`,
            }}
          >
            <div className="flex h-[102px] w-[102px] flex-col items-center justify-center rounded-full bg-card">
              <span className="text-3xl font-bold leading-none">
                {occupancyPct}%
              </span>
              <span className="text-[11.5px] font-semibold text-ink-faint">
                av {totalSeats} platser
              </span>
            </div>
          </div>
          <p className="text-center text-[12.5px] text-ink-faint">
            {guestsTonight} {guestsTonight === 1 ? "gäst" : "gäster"} bokade av{" "}
            {totalSeats} möjliga
          </p>
        </div>
      </div>

      {/* Nästa ankomster — tidsgrupperade som i bokningslistan */}
      <div className="mt-4 rounded-card border border-line-card bg-card p-6 shadow-card">
        <div className="mb-2 flex items-center justify-between">
          <p className="text-[15px] font-bold">Nästa ankomster</p>
          <Link
            href={`/bookings/${slug}`}
            className="text-[13.5px] font-bold text-accent hover:text-accent-dark"
          >
            Visa alla →
          </Link>
        </div>
        {waitingCount > 0 && (
          <Link
            href={`/bookings/${slug}`}
            className="mb-3 flex items-center justify-between rounded-xl border border-status-grace-border bg-status-grace-bg px-4 py-2.5 text-[13px] font-semibold text-status-grace-fg transition hover:brightness-110"
          >
            <span>
              Väntelista: {waitingCount} i kö väntar på bord ikväll
            </span>
            <span aria-hidden>→</span>
          </Link>
        )}
        {groups.length > 0 ? (
          groups.map((g) => (
            <div key={g.time}>
              <div className="flex items-center gap-3 pb-1 pt-3">
                <span className="text-[13px] font-bold tracking-wide text-accent">
                  {g.time}
                </span>
                <div className="h-px flex-1 bg-line" />
                <span className="text-[11.5px] font-semibold text-ink-faint">
                  {g.items.length} bokn. ·{" "}
                  {g.items.reduce((n, b) => n + b.partySize, 0)} gäster
                </span>
              </div>
              {g.items.map((b) => {
                const name =
                  b.guest.name ?? b.guest.email ?? b.guest.phone ?? "Gäst";
                const pill = STATUS_PILLS[b.status] ?? STATUS_PILLS.CONFIRMED;
                return (
                  <div key={b.id} className="flex items-center gap-4 py-2.5">
                    <Avatar name={name} size={38} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[14.5px] font-semibold">
                        {name}
                      </p>
                      <p className="text-[12.5px] text-ink-faint">
                        {b.partySize} pers
                        {b.table ? ` · ${b.table.name}` : ""} ·{" "}
                        {SOURCE_LABELS[b.createdBy] ?? b.createdBy}
                      </p>
                    </div>
                    <span
                      className={`rounded-pill px-2.5 py-0.5 text-[11.5px] font-bold ${pill.className}`}
                    >
                      {pill.label}
                    </span>
                  </div>
                );
              })}
            </div>
          ))
        ) : (
          <p className="border-t border-line pt-3 text-sm text-ink-faint">
            Inga kommande ankomster idag.
          </p>
        )}
      </div>
    </div>
  );
}
