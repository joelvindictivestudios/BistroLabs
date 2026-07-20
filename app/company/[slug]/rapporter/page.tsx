import { redirect } from "next/navigation";
import { prisma } from "@/lib/db/client";
import { getUser } from "@/lib/auth/server";
import { parseRestaurantConfig } from "@/lib/email-concierge/types";
import { getNoShowReport } from "@/lib/restaurant/reports";

export const metadata = { title: "Rapporter — BistroLabs" };

// Rapporterna (§3.13): no-show-skyddets effekt över tid — KPI:er med
// före/efter kortgarantin plus graferna no-shows per vecka och beläggning
// per veckodag. Kvällens läge bor på Översikten; det här är kontorsvyn.
export default async function ReportsPage({
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

  const tables = await prisma.diningTable.findMany({
    where: { restaurantId: restaurant.id },
    select: { capacity: true },
  });
  const totalSeats = tables.reduce((sum, t) => sum + t.capacity, 0);

  const report = await getNoShowReport(restaurant.id, config, totalSeats);
  const maxWeeklyNoShows = Math.max(
    1,
    ...report.weeklyNoShows.map((w) => w.count),
  );

  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="text-2xl font-semibold tracking-tight [font-family:var(--font-display),sans-serif]">
        Rapporter
      </h1>
      <p className="mt-1 text-sm text-[var(--w-muted)]">
        No-show-skyddets effekt — senaste 30 dagarna, jämfört med tiden före
        kortgarantin.
      </p>

      <div className="mt-6 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-card border border-line-card bg-card p-5 shadow-card">
          <p className="text-[12.5px] font-semibold text-ink-faint">
            No-show-andel · 30 dgr
          </p>
          <p className="mt-2 text-3xl font-bold leading-none tracking-tight">
            {report.kpis.noShowSharePct === null
              ? "—"
              : `${String(report.kpis.noShowSharePct).replace(".", ",")}%`}
          </p>
          <p
            className={`mt-2 text-xs font-semibold ${
              report.kpis.noShowShareBeforePct !== null &&
              report.kpis.noShowSharePct !== null &&
              report.kpis.noShowSharePct < report.kpis.noShowShareBeforePct
                ? "text-status-seated-fg"
                : "text-ink-faint"
            }`}
          >
            {report.kpis.noShowShareBeforePct !== null
              ? `↓ från ${String(report.kpis.noShowShareBeforePct).replace(".", ",")}% före kortgarantin`
              : "kortgarantin ej införd ännu"}
          </p>
        </div>
        <div className="rounded-card border border-line-card bg-card p-5 shadow-card">
          <p className="text-[12.5px] font-semibold text-ink-faint">
            Debiterade avgifter · 30 dgr
          </p>
          <p className="mt-2 text-3xl font-bold leading-none tracking-tight">
            {report.kpis.chargedTotal.toLocaleString("sv-SE")} kr
          </p>
          <p className="mt-2 text-xs font-semibold text-ink-faint">
            {report.kpis.chargedGuests} no-show-gäster
          </p>
        </div>
        <div className="rounded-card border border-line-card bg-card p-5 shadow-card">
          <p className="text-[12.5px] font-semibold text-ink-faint">
            Avbokningar · 30 dgr
          </p>
          <p className="mt-2 text-3xl font-bold leading-none tracking-tight">
            {report.kpis.cancellations}
          </p>
          <p className="mt-2 text-xs font-semibold text-ink-faint">
            varav {report.kpis.autoCancellations} auto-avbokade
          </p>
        </div>
        <div className="rounded-card border border-line-card bg-card p-5 shadow-card">
          <p className="text-[12.5px] font-semibold text-ink-faint">
            Snittbeläggning · 30 dgr
          </p>
          <p className="mt-2 text-3xl font-bold leading-none tracking-tight">
            {report.kpis.avgOccupancyPct === null
              ? "—"
              : `${report.kpis.avgOccupancyPct}%`}
          </p>
          <p className="mt-2 text-xs font-semibold text-ink-faint">
            öppna dagar, bokade gäster
          </p>
        </div>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <div className="rounded-card border border-line-card bg-card p-6 shadow-card">
          <p className="text-[15px] font-bold">No-shows per vecka</p>
          <p className="mt-0.5 text-[13px] text-ink-faint">
            {report.guaranteeIntroduced
              ? "Mörka staplar = efter kortgarantin"
              : "Senaste 8 veckorna"}
          </p>
          <div className="mt-6 flex h-36 items-end gap-3.5">
            {report.weeklyNoShows.map((w) => (
              <div
                key={w.week}
                className="flex h-full flex-1 flex-col items-center justify-end gap-2"
              >
                <span className="text-xs font-bold text-ink-muted">
                  {w.count}
                </span>
                <div
                  className={`w-full rounded-t-[7px] ${
                    w.afterGuarantee ? "bg-accent" : "bg-accent/45"
                  }`}
                  style={{
                    height: `${Math.max(4, Math.round((w.count / maxWeeklyNoShows) * 100))}%`,
                  }}
                />
                <span className="text-xs text-ink-faint">{w.week}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-card border border-line-card bg-card p-6 shadow-card">
          <p className="text-[15px] font-bold">Beläggning per veckodag</p>
          <p className="mt-0.5 text-[13px] text-ink-faint">
            Snitt senaste 30 dagarna
          </p>
          <div className="mt-5 space-y-2.5">
            {report.dowOccupancy.map((o) => (
              <div key={o.day} className="flex items-center gap-3">
                <span className="w-9 text-[13px] font-semibold text-ink-muted">
                  {o.day}
                </span>
                <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-[var(--bg-hover)]">
                  <div
                    className={`h-full rounded-full ${
                      (o.pct ?? 0) >= 90 ? "bg-accent" : "bg-accent/45"
                    }`}
                    style={{ width: `${o.pct ?? 0}%` }}
                  />
                </div>
                <span
                  className={`w-12 text-right text-[13px] font-bold ${
                    o.pct === null ? "text-ink-faint" : ""
                  }`}
                >
                  {o.pct === null ? "Stängt" : `${o.pct}%`}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
