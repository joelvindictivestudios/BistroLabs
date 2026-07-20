import { redirect } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { prisma } from "@/lib/db/client";
import { getUser } from "@/lib/auth/server";
import { parseRestaurantConfig } from "@/lib/email-concierge/types";
import { getCompanyInfoStatus } from "@/lib/restaurant/core-facts";
import { localToUtc } from "@/lib/booking/availability";
import { adminTheme } from "@/lib/theme";
import { Avatar } from "@/app/components/avatar";
import SideRays from "@/app/components/SideRays";
import { LogoutButton } from "./logout-button";
import { ModuleCard } from "./module-card";
import { BrandLogo } from "@/app/components/brand-logo";

export const metadata = { title: "Översikt — BistroLabs" };

const ACTIVE_STATUSES = ["PENDING", "CONFIRMED", "SEATED", "COMPLETED"] as const;

const SOURCE_LABELS: Record<string, string> = {
  widget: "Widget",
  concierge: "AI-mejl",
  dropin: "Drop-in",
  human: "Manuell",
};

const STATUS_PILLS: Record<
  string,
  { label: string; className: string }
> = {
  PENDING: {
    label: "Preliminär",
    className: "bg-status-pending-bg text-status-pending-fg",
  },
  CONFIRMED: {
    label: "Bokad",
    className: "bg-status-booked-bg text-status-booked-fg",
  },
  SEATED: {
    label: "Sitter",
    className: "bg-status-seated-bg text-status-seated-fg",
  },
  COMPLETED: {
    label: "Klar",
    className: "bg-status-done-bg text-status-done-fg",
  },
  NO_SHOW: {
    label: "No-show",
    className: "bg-status-late-bg text-status-late-fg",
  },
  CANCELLED: {
    label: "Avbokad",
    className: "bg-status-late-bg text-status-late-fg",
  },
};

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
  const { dataTheme, sideRays } = adminTheme(config);
  const companyInfo = await getCompanyInfoStatus(restaurant, config);

  // --- Rapporter: dagens bokningar + platser, allt i restaurangens tidszon ---
  const today = new Intl.DateTimeFormat("sv-SE", {
    timeZone: config.timezone,
  }).format(new Date()); // "YYYY-MM-DD"
  const dayStart = localToUtc(today, "00:00", config.timezone);
  const dayEnd = new Date(dayStart.getTime() + 24 * 3600_000);

  const [todaysBookings, tables, pendingDrafts] = await Promise.all([
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
    prisma.emailMessage.count({
      where: {
        thread: { restaurantId: restaurant.id },
        direction: "OUTBOUND",
        status: { in: ["DRAFT", "ESCALATED"] },
        handledAt: null,
      },
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

  // Gäster per timme — prognos från dagens aktiva bokningar
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

  // Nästa ankomster: kommande PENDING/CONFIRMED, annars kvällens senaste
  const now = new Date();
  const upcoming = active
    .filter(
      (b) =>
        (b.status === "PENDING" || b.status === "CONFIRMED") && b.endsAt > now,
    )
    .slice(0, 4);
  const timeFmt = new Intl.DateTimeFormat("sv-SE", {
    timeZone: config.timezone,
    hour: "2-digit",
    minute: "2-digit",
  });

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
      href: `/company/${slug}/inbox`,
      title: "AI-inkorg",
      icon: "/mailiconoverview.png",
      description:
        "Gästmejlen AI:n har skrivit utkast till — granska, redigera och godkänn.",
      badge: pendingDrafts,
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
      data-theme={dataTheme}
      className="relative min-h-dvh overflow-hidden bg-app text-ink"
    >
      <div aria-hidden className="pointer-events-none absolute inset-0">
        {sideRays ? (
          <SideRays
            speed={1.5}
            rayColor1={sideRays.rayColor1}
            rayColor2={sideRays.rayColor2}
            intensity={2}
            spread={2}
            origin="top-right"
            tilt={0}
            saturation={1.5}
            blend={0.75}
            falloff={1.6}
            opacity={sideRays.opacity}
          />
        ) : (
          <div
            className="absolute inset-0"
            style={{
              background:
                "radial-gradient(80% 60% at 70% 0%, rgba(192,103,63,0.13), transparent 60%)",
            }}
          />
        )}
      </div>

      <header className="relative z-10 flex h-16 items-center justify-between border-b border-line px-6">
        <BrandLogo />
        <LogoutButton userEmail={user.email ?? ""} />
      </header>

      <main className="relative z-10 mx-auto max-w-4xl px-6 py-12">
        <p className="text-[11px] uppercase tracking-[0.22em] text-ink-muted">
          Översikt
        </p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight [font-family:var(--font-display),sans-serif]">
          {restaurant.name}
        </h1>

        <div className="mt-10 grid gap-4 md:grid-cols-2 lg:grid-cols-5">
          {modules.map((m) => (
            <ModuleCard key={m.href} {...m} />
          ))}
        </div>

        {/* Bokningar — fullbreddskort med foto + mörk overlay nertill */}
        <Link
          href={`/bookings/${slug}`}
          className="group relative mt-4 block h-56 overflow-hidden rounded-2xl border border-line transition-colors motion-safe:duration-150 hover:border-accent"
        >
          <Image
            src="/restaurant.jpg"
            alt=""
            fill
            sizes="(min-width: 1024px) 896px, 100vw"
            className="object-cover transition-transform motion-safe:duration-300 group-hover:scale-[1.03]"
          />
          <div className="absolute inset-x-0 bottom-0 h-[60%] bg-gradient-to-t from-black/95 via-black/65 to-transparent" />
          <span className="absolute bottom-5 left-6 text-3xl font-semibold tracking-tight text-white [font-family:var(--font-display),sans-serif]">
            Bokningar
          </span>
        </Link>

        {/* Rapporter — KPI:er, gäster/timme, beläggning, nästa ankomster */}
        <div className="mt-4 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {kpis.map((k) => (
            <div
              key={k.label}
              className="rounded-card border border-line-card bg-card p-5 shadow-card"
            >
              <p className="text-[12.5px] font-semibold text-ink-faint">
                {k.label}
              </p>
              <p className="mt-2 text-3xl font-bold leading-none tracking-tight">
                {k.value}
              </p>
              <p className={`mt-2 text-xs font-semibold ${k.deltaClass}`}>
                {k.delta}
              </p>
            </div>
          ))}
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-[1.5fr_1fr]">
          <div className="rounded-card border border-line-card bg-card p-6 shadow-card">
            <p className="text-[15px] font-bold">Gäster per timme</p>
            <p className="mt-0.5 text-[13px] text-ink-faint">
              Ikväll · prognos från bokningar
            </p>
            {hourBars.length > 0 ? (
              <div className="mt-6 flex h-36 items-end gap-3.5">
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
            ) : (
              <p className="mt-6 text-sm text-ink-faint">
                Inga bokningar idag ännu.
              </p>
            )}
          </div>

          <div className="flex flex-col items-center rounded-card border border-line-card bg-card p-6 shadow-card">
            <p className="self-start text-[15px] font-bold">
              Beläggning ikväll
            </p>
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
              {guestsTonight}{" "}
              {guestsTonight === 1 ? "gäst" : "gäster"} bokade av{" "}
              {totalSeats} möjliga
            </p>
          </div>
        </div>

        <div className="mt-4 rounded-card border border-line-card bg-card p-6 shadow-card">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-[15px] font-bold">Nästa ankomster</p>
            <Link
              href={`/bookings/${slug}`}
              className="text-[13.5px] font-bold text-accent hover:text-accent-dark"
            >
              Visa alla →
            </Link>
          </div>
          {upcoming.length > 0 ? (
            upcoming.map((b) => {
              const name =
                b.guest.name ?? b.guest.email ?? b.guest.phone ?? "Gäst";
              const pill = STATUS_PILLS[b.status] ?? STATUS_PILLS.CONFIRMED;
              return (
                <div
                  key={b.id}
                  className="flex items-center gap-4 border-t border-line py-3"
                >
                  <span className="w-[52px] text-[15px] font-bold">
                    {timeFmt.format(b.startsAt)}
                  </span>
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
            })
          ) : (
            <p className="border-t border-line pt-3 text-sm text-ink-faint">
              Inga kommande ankomster idag.
            </p>
          )}
        </div>
      </main>
    </div>
  );
}
