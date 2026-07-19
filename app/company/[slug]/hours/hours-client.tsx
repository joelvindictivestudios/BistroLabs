"use client";

import { useState } from "react";

// Öppettider: veckorytmen (schema med 24h-tidslinjer per dag) + undantags-
// kalendern (röda dagar = stängt helt, bokningsstopp = gästspärr).
// Signatur: varje öppen dag ritas som en mässingsstapel på ett dygnsspår —
// veckans rytm läses på en blick.

const WEEKDAYS = [
  { key: "mon", label: "Måndag", short: "Mån" },
  { key: "tue", label: "Tisdag", short: "Tis" },
  { key: "wed", label: "Onsdag", short: "Ons" },
  { key: "thu", label: "Torsdag", short: "Tor" },
  { key: "fri", label: "Fredag", short: "Fre" },
  { key: "sat", label: "Lördag", short: "Lör" },
  { key: "sun", label: "Söndag", short: "Sön" },
] as const;

type DayKey = (typeof WEEKDAYS)[number]["key"];
type TimeRange = { open: string; close: string };
/** Flera pass per dag (lunch + middag); tom lista = stängt. */
type DayHours = TimeRange[];

type Props = {
  slug: string;
  initialConfig: {
    openingHours: Record<string, { open: string; close: string }[]>;
    closedDates: string[];
    bookingStopDates: string[];
  };
};

function toHours(
  openingHours: Props["initialConfig"]["openingHours"],
): Record<DayKey, DayHours> {
  const hours = {} as Record<DayKey, DayHours>;
  for (const { key } of WEEKDAYS) {
    hours[key] = (openingHours[key] ?? []).map((r) => ({ ...r }));
  }
  return hours;
}

function toMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

function fromMinutes(m: number): string {
  const clamped = Math.min(m, 23 * 60 + 59);
  return `${String(Math.floor(clamped / 60)).padStart(2, "0")}:${String(clamped % 60).padStart(2, "0")}`;
}

/** Klientvalidering — samma regler som API:t (open<close, ej överlapp). */
function validateHours(
  hours: Record<DayKey, DayHours>,
): string | null {
  for (const { key, short } of WEEKDAYS) {
    const ranges = [...hours[key]].sort(
      (a, b) => toMinutes(a.open) - toMinutes(b.open),
    );
    for (const r of ranges) {
      if (toMinutes(r.open) >= toMinutes(r.close)) {
        return `Stängningstiden måste vara efter öppningstiden (${short.toLowerCase()})`;
      }
    }
    for (let i = 1; i < ranges.length; i++) {
      if (toMinutes(ranges[i - 1].close) > toMinutes(ranges[i].open)) {
        return `Passen överlappar varandra (${short.toLowerCase()})`;
      }
    }
  }
  if (WEEKDAYS.every(({ key }) => hours[key].length === 0)) {
    return "Minst en dag måste ha öppettider.";
  }
  return null;
}

export function HoursClient({ slug, initialConfig }: Props) {
  const [hours, setHours] = useState(() => toHours(initialConfig.openingHours));
  const [closedDates, setClosedDates] = useState<string[]>(
    initialConfig.closedDates,
  );
  const [stopDates, setStopDates] = useState<string[]>(
    initialConfig.bookingStopDates,
  );
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    const validationError = validateHours(hours);
    if (validationError) {
      setError(validationError);
      setSavedAt(null);
      return;
    }
    setSaving(true);
    setError(null);
    setSavedAt(null);
    try {
      const res = await fetch(`/api/restaurants/${slug}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          openingHours: hours,
          closedDates,
          bookingStopDates: stopDates,
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error ?? "Kunde inte spara.");
        return;
      }
      setSavedAt(Date.now());
    } catch {
      setError("Något gick fel — prova igen.");
    } finally {
      setSaving(false);
    }
  }

  const openDays = WEEKDAYS.filter(({ key }) => hours[key].length > 0);
  const weeklyMinutes = openDays.reduce(
    (sum, { key }) =>
      sum +
      hours[key].reduce(
        (daySum, r) =>
          daySum + Math.max(0, toMinutes(r.close) - toMinutes(r.open)),
        0,
      ),
    0,
  );

  return (
    <div className="mx-auto max-w-5xl">
      {/* Sidhuvud med veckosummering */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight [font-family:var(--font-display),sans-serif]">
            Öppettider
          </h1>
          <p className="mt-1 text-sm text-[var(--w-muted)]">
            Öppet {openDays.length} dagar i veckan ·{" "}
            <span className="font-mono text-[var(--w-ink)]">
              {Math.round(weeklyMinutes / 60)} h
            </span>{" "}
            bokningsbar tid
          </p>
        </div>
        <div className="flex items-center gap-3">
          {error && <span className="text-xs text-yellow-400">{error}</span>}
          {savedAt && !error && (
            <span className="text-xs text-emerald-400">Sparat ✓</span>
          )}
          <button
            onClick={save}
            disabled={saving}
            className="h-10 rounded-xl bg-[var(--w-accent)] px-5 text-sm font-semibold text-[#141210] shadow-lg shadow-black/25 hover:brightness-110 disabled:opacity-60 transition"
          >
            {saving ? "Sparar…" : "Spara"}
          </button>
        </div>
      </div>

      <div className="mt-10 grid gap-12 lg:grid-cols-[minmax(0,10fr)_minmax(0,9fr)] lg:gap-10">
        {/* Veckorytmen */}
        <section>
          <h2 className="text-[11px] uppercase tracking-[0.22em] text-[var(--w-muted)]">
            Veckorytm
          </h2>
          <div className="mt-4 overflow-hidden rounded-2xl border border-[var(--w-line)] bg-[var(--w-panel)]">
            {WEEKDAYS.map(({ key, label }, i) => {
              const ranges = hours[key];
              const open = ranges.length > 0;
              const setRanges = (next: TimeRange[]) =>
                setHours((h) => ({ ...h, [key]: next }));
              return (
                <div
                  key={key}
                  className={`flex items-start gap-4 px-4 py-3 ${
                    i > 0 ? "border-t border-[var(--w-line)]/60" : ""
                  } ${open ? "" : "opacity-60"}`}
                >
                  <div className="flex h-8 items-center">
                    <Switch
                      checked={open}
                      label={`${label} ${open ? "öppet" : "stängt"}`}
                      onChange={(on) =>
                        setRanges(on ? [{ open: "17:00", close: "23:00" }] : [])
                      }
                    />
                  </div>
                  <span className="w-16 pt-1.5 text-sm">{label}</span>

                  {open ? (
                    // Passen i en egen smal kolumn; dygnsspåret + timsumman
                    // ligger bredvid och trängs aldrig ut av ✕-knapparna
                    <div className="flex min-w-0 flex-1 items-start gap-4">
                      <div className="flex shrink-0 flex-col gap-2">
                        {ranges.map((range, ri) => (
                          <div key={ri} className="flex items-center gap-2">
                            <TimeInput
                              value={range.open}
                              onChange={(v) =>
                                setRanges(
                                  ranges.map((r, idx) =>
                                    idx === ri ? { ...r, open: v } : r,
                                  ),
                                )
                              }
                            />
                            <span className="text-[var(--w-muted)]">–</span>
                            <TimeInput
                              value={range.close}
                              onChange={(v) =>
                                setRanges(
                                  ranges.map((r, idx) =>
                                    idx === ri ? { ...r, close: v } : r,
                                  ),
                                )
                              }
                            />
                            {ranges.length > 1 && (
                              <button
                                type="button"
                                onClick={() =>
                                  setRanges(
                                    ranges.filter((_, idx) => idx !== ri),
                                  )
                                }
                                aria-label={`Ta bort pass ${ri + 1} (${label})`}
                                className="rounded px-1.5 py-0.5 text-xs text-[var(--w-muted)] hover:text-[var(--w-ink)] transition"
                              >
                                ✕
                              </button>
                            )}
                          </div>
                        ))}
                        {ranges.length < 4 && (
                          <button
                            type="button"
                            onClick={() => {
                              const lastClose = toMinutes(
                                ranges[ranges.length - 1].close,
                              );
                              setRanges([
                                ...ranges,
                                {
                                  open: fromMinutes(lastClose + 60),
                                  close: fromMinutes(lastClose + 180),
                                },
                              ]);
                            }}
                            className="self-start rounded-lg border border-dashed border-[var(--w-line)] px-2.5 py-1 text-xs text-[var(--w-muted)] hover:border-[var(--w-muted)] hover:text-[var(--w-ink)] transition"
                          >
                            + Lägg till pass
                          </button>
                        )}
                      </div>
                      <DayTrack ranges={ranges} />
                    </div>
                  ) : (
                    <>
                      <span className="pt-1.5 text-xs text-[var(--w-muted)]">
                        Stängt
                      </span>
                      <DayTrack ranges={[]} />
                    </>
                  )}
                </div>
              );
            })}
          </div>
          <p className="mt-2 text-xs text-[var(--w-muted)]">
            Schemat styr vilka tider gäster kan boka i widgeten, per telefon och
            mejl.
          </p>
        </section>

        {/* Undantagskalendern */}
        <CalendarSection
          closedDates={closedDates}
          stopDates={stopDates}
          weeklyClosed={WEEKDAYS.filter(({ key }) => hours[key].length === 0).map(
            ({ key }) => key,
          )}
          onChange={(nextClosed, nextStops) => {
            setClosedDates(nextClosed);
            setStopDates(nextStops);
          }}
        />
      </div>
    </div>
  );
}

/** Dygnsspår 00–24 med en mässingsstapel per pass — sidans signatur. */
function DayTrack({ ranges }: { ranges: TimeRange[] }) {
  const totalMinutes = ranges.reduce(
    (sum, r) => sum + Math.max(0, toMinutes(r.close) - toMinutes(r.open)),
    0,
  );
  const duration = Math.round((totalMinutes / 60) * 10) / 10;

  return (
    // mt centrerar spåret mot första passraden (raderna är items-start)
    <div className="ml-auto mt-2.5 hidden min-w-0 flex-1 items-center gap-3 sm:flex">
      <div className="relative h-1.5 min-w-24 flex-1 rounded-full bg-[var(--w-bg)]">
        {/* Diskreta dygnsmarkeringar: 06, 12, 18 */}
        {[25, 50, 75].map((pct) => (
          <span
            key={pct}
            className="absolute top-1/2 h-2.5 w-px -translate-y-1/2 bg-[var(--w-line)]"
            style={{ left: `${pct}%` }}
          />
        ))}
        {ranges.map((r, i) => {
          const start = (toMinutes(r.open) / 1440) * 100;
          const width = Math.max(
            0,
            (toMinutes(r.close) / 1440) * 100 - start,
          );
          return width > 0 ? (
            <span
              key={i}
              className="absolute inset-y-0 rounded-full bg-[var(--w-accent)]"
              style={{ left: `${start}%`, width: `${width}%` }}
            />
          ) : null;
        })}
      </div>
      <span className="w-10 shrink-0 text-right font-mono text-[11px] text-[var(--w-muted)]">
        {duration > 0 ? `${duration} h` : "—"}
      </span>
    </div>
  );
}

function Switch({
  checked,
  label,
  onChange,
}: {
  checked: boolean;
  label: string;
  onChange: (on: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      // DESIGN-SYSTEM §5: 38×21-pill med 17 px vit knopp. left-0 är viktigt —
      // utan den utgår absolut positionering från knappens centrerade
      // textposition och knoppen hamnar utanför spåret.
      className={`relative h-[21px] w-[38px] shrink-0 rounded-full transition-colors motion-safe:duration-200 focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--w-accent)] ${
        checked ? "bg-[var(--w-accent)]" : "bg-[var(--w-line)]"
      }`}
    >
      <span
        className={`absolute left-0 top-0.5 h-[17px] w-[17px] rounded-full bg-white shadow-sm transition-transform motion-safe:duration-200 ${
          checked ? "translate-x-[19px]" : "translate-x-0.5"
        }`}
      />
    </button>
  );
}

function TimeInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <input
      type="time"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="rounded-lg border border-[var(--w-line)] bg-[var(--w-bg)] px-2 py-1 font-mono text-xs text-[var(--w-ink)] focus:border-[var(--w-accent)] focus:outline-none [color-scheme:dark]"
    />
  );
}

type Pen = "red" | "stop";

const WEEKDAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

function toDateString(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Undantagskalendern (WaiterAid-stil): välj penna, klicka på dagar.
function CalendarSection({
  closedDates,
  stopDates,
  weeklyClosed,
  onChange,
}: {
  closedDates: string[];
  stopDates: string[];
  weeklyClosed: string[];
  onChange: (closed: string[], stops: string[]) => void;
}) {
  const [pen, setPen] = useState<Pen>("red");
  const [offset, setOffset] = useState(0);

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const first = new Date(today.getFullYear(), today.getMonth() + offset, 1);
  const monthLabel = first.toLocaleDateString("sv-SE", {
    month: "long",
    year: "numeric",
  });
  const daysInMonth = new Date(
    first.getFullYear(),
    first.getMonth() + 1,
    0,
  ).getDate();
  const leadingBlanks = (first.getDay() + 6) % 7; // måndag först

  function toggle(dateStr: string) {
    const inClosed = closedDates.includes(dateStr);
    const inStops = stopDates.includes(dateStr);
    if (pen === "red") {
      onChange(
        inClosed
          ? closedDates.filter((d) => d !== dateStr)
          : [...closedDates, dateStr].sort(),
        stopDates.filter((d) => d !== dateStr), // en dag kan inte vara båda
      );
    } else {
      onChange(
        closedDates.filter((d) => d !== dateStr),
        inStops
          ? stopDates.filter((d) => d !== dateStr)
          : [...stopDates, dateStr].sort(),
      );
    }
  }

  return (
    <section>
      <h2 className="text-[11px] uppercase tracking-[0.22em] text-[var(--w-muted)]">
        Undantag
      </h2>

      <div className="mt-4 overflow-hidden rounded-2xl border border-[var(--w-line)] bg-[var(--w-panel)]">
        {/* Pennväljare — segmenterad kontroll */}
        <div className="flex border-b border-[var(--w-line)]/60 p-1.5">
          <PenButton
            active={pen === "red"}
            dotClass="bg-red-400"
            activeClass="bg-red-500/10 text-red-300"
            count={closedDates.length}
            onClick={() => setPen("red")}
          >
            Röd dag
          </PenButton>
          <PenButton
            active={pen === "stop"}
            dotClass="bg-yellow-400"
            activeClass="bg-yellow-500/10 text-yellow-300"
            count={stopDates.length}
            onClick={() => setPen("stop")}
          >
            Bokningsstopp
          </PenButton>
        </div>

        <div className="p-4">
          {/* Månadsnavigering */}
          <div className="mb-3 flex items-center justify-between">
            <button
              onClick={() => setOffset((o) => Math.max(0, o - 1))}
              disabled={offset === 0}
              aria-label="Föregående månad"
              className="h-8 w-8 rounded-lg text-[var(--w-muted)] hover:bg-[var(--w-bg)] hover:text-[var(--w-ink)] disabled:opacity-30 transition"
            >
              ‹
            </button>
            <p className="text-sm font-medium capitalize">{monthLabel}</p>
            <button
              onClick={() => setOffset((o) => Math.min(11, o + 1))}
              disabled={offset >= 11}
              aria-label="Nästa månad"
              className="h-8 w-8 rounded-lg text-[var(--w-muted)] hover:bg-[var(--w-bg)] hover:text-[var(--w-ink)] disabled:opacity-30 transition"
            >
              ›
            </button>
          </div>

          <div className="grid grid-cols-7 gap-1 text-center text-[10px] uppercase tracking-[0.15em] text-[var(--w-muted)]/70">
            {["Må", "Ti", "On", "To", "Fr", "Lö", "Sö"].map((d) => (
              <span key={d} className="py-1">
                {d}
              </span>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {Array.from({ length: leadingBlanks }).map((_, i) => (
              <span key={`blank-${i}`} />
            ))}
            {Array.from({ length: daysInMonth }, (_, i) => {
              const d = new Date(first.getFullYear(), first.getMonth(), i + 1);
              const dateStr = toDateString(d);
              const past = d < today;
              const isClosed = closedDates.includes(dateStr);
              const isStop = stopDates.includes(dateStr);
              const isWeeklyClosed = weeklyClosed.includes(
                WEEKDAY_KEYS[d.getDay()],
              );
              const isToday = dateStr === toDateString(today);
              return (
                <button
                  key={dateStr}
                  disabled={past}
                  onClick={() => toggle(dateStr)}
                  title={
                    isClosed
                      ? "Röd dag — klicka för att öppna igen"
                      : isStop
                        ? "Bokningsstopp — klicka för att ta bort"
                        : isWeeklyClosed
                          ? "Stängt enligt veckoschemat"
                          : undefined
                  }
                  className={`relative h-10 rounded-lg text-sm tabular-nums transition-colors motion-safe:duration-150 ${
                    past
                      ? "cursor-default text-[var(--w-muted)]/25"
                      : isClosed
                        ? "bg-red-500/15 font-semibold text-red-300 shadow-[inset_0_0_0_1px_rgba(248,113,113,0.5)]"
                        : isStop
                          ? "bg-yellow-500/10 font-semibold text-yellow-300 shadow-[inset_0_0_0_1px_rgba(250,204,21,0.45)]"
                          : isWeeklyClosed
                            ? "text-[var(--w-muted)]/45 hover:bg-[var(--w-bg)]"
                            : "text-[var(--w-ink)]/85 hover:bg-[var(--w-bg)]"
                  } ${isToday ? "shadow-[inset_0_0_0_1px_var(--w-accent)]" : ""}`}
                >
                  {i + 1}
                </button>
              );
            })}
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-[var(--w-line)]/60 pt-3 text-[11px] text-[var(--w-muted)]">
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-red-400" /> Stängt helt
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-yellow-400" /> Endast
              drop-in
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-[var(--w-muted)]/40" />{" "}
              Stängt enl. schema
            </span>
          </div>
        </div>
      </div>
      <p className="mt-2 text-xs text-[var(--w-muted)]">
        Röd dag stänger dagen helt. Bokningsstopp låter befintliga bokningar stå
        kvar men stoppar nya från gäster — personalen kan alltid lägga drop-ins.
      </p>
    </section>
  );
}

function PenButton({
  active,
  dotClass,
  activeClass,
  count,
  onClick,
  children,
}: {
  active: boolean;
  dotClass: string;
  activeClass: string;
  count: number;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={`flex flex-1 items-center justify-center gap-2 rounded-xl px-3 py-2 text-sm transition-colors motion-safe:duration-150 ${
        active
          ? activeClass
          : "text-[var(--w-muted)] hover:text-[var(--w-ink)]"
      }`}
    >
      <span className={`h-2 w-2 rounded-full ${dotClass}`} />
      {children}
      {count > 0 && (
        <span className="rounded-full bg-[var(--w-bg)] px-1.5 text-[10px] font-medium">
          {count}
        </span>
      )}
    </button>
  );
}
