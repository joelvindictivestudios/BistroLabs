"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

// Bokningswidget i fem steg: gäster → datum → tid → uppgifter → bekräftat.
// Signaturen är meningen som byggs upp medan man väljer:
// "Ett bord för 2 · fre 10 juli · 19:00".

type Offering = {
  id: string;
  title: string;
  description: string;
  imageUrl: string;
};

type Props = {
  slug: string;
  name: string;
  openDays: string[]; // ["tue", ..., "sat"]
  maxParty: number;
  menu: string;
  hoursDisplay: { day: string; hours: string }[];
  offerings: Offering[];
  heroImageUrl: string;
  logoUrl: string;
  /** Röda dagar + bokningsstopp (YYYY-MM-DD) — släcks i kalendern. */
  closedDates?: string[];
  bookingStopDates?: string[];
  /** Widgetens tema: "classic" (mörk, nuvarande) eller "warm-light" (GPG ljus). */
  theme?: "classic" | "warm-light";
  /** Renderad inuti editorns preview-yta — fyll containern istället för viewporten. */
  embedded?: boolean;
};

type Step = "start" | "party" | "date" | "time" | "details" | "done";

type Confirmation = {
  bookingId: string;
  tableName: string;
  date: string;
  time: string;
  partySize: number;
};

type ChatMessage = { role: "user" | "assistant"; content: string };

const WEEKDAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
const MONTHS_AHEAD = 3;

function toDateString(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function formatLong(dateStr: string): string {
  return new Date(`${dateStr}T12:00:00`).toLocaleDateString("sv-SE", {
    weekday: "short",
    day: "numeric",
    month: "long",
  });
}

export function BookingWidget({
  slug,
  name,
  openDays,
  maxParty,
  menu,
  hoursDisplay,
  offerings,
  heroImageUrl,
  logoUrl,
  closedDates = [],
  bookingStopDates = [],
  theme = "classic",
  embedded = false,
}: Props) {
  const hasStart = offerings.length > 0;
  const [step, setStep] = useState<Step>(hasStart ? "start" : "party");
  const [offering, setOffering] = useState<Offering | null>(null);
  const [party, setParty] = useState<number | null>(null);
  const [date, setDate] = useState<string | null>(null);
  const [time, setTime] = useState<string | null>(null);
  const [monthOffset, setMonthOffset] = useState(0);
  const [slots, setSlots] = useState<string[] | null>(null);
  const [slotsError, setSlotsError] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);

  // Byggs upp till en mening allteftersom valen görs
  const sentence = useMemo(() => {
    const parts: string[] = [];
    if (offering) parts.push(offering.title);
    if (party) parts.push(`Ett bord för ${party}`);
    if (date) parts.push(formatLong(date));
    if (time) parts.push(`kl ${time}`);
    return parts.join(" · ");
  }, [offering, party, date, time]);

  const slotsRequestId = useRef(0);
  const loadSlots = useCallback(
    (d: string, p: number) => {
      const requestId = ++slotsRequestId.current;
      setSlots(null);
      setSlotsError(null);
      fetch(`/api/widget/${slug}/slots?date=${d}&party=${p}`)
        .then((r) => r.json())
        .then((data) => {
          if (requestId !== slotsRequestId.current) return;
          if (data.blockedReason) {
            setSlots([]);
            setSlotsError(data.blockedReason);
          } else if (Array.isArray(data.slots)) setSlots(data.slots);
          else setSlotsError(data.error ?? "Kunde inte hämta tider");
        })
        .catch(() => {
          if (requestId === slotsRequestId.current)
            setSlotsError("Kunde inte hämta tider");
        });
    },
    [slug],
  );

  const goBack = () => {
    if (step === "party" && hasStart) setStep("start");
    else if (step === "date") setStep("party");
    else if (step === "time") setStep("date");
    else if (step === "details") setStep("time");
  };

  return (
    <div
      data-theme={theme === "warm-light" ? "light" : "widget-classic"}
      className={`${embedded ? "h-full" : "min-h-dvh bg-shell lg:h-dvh lg:p-3"} text-[var(--w-ink)]`}
      // Widgeten behåller sin serif (Fraunces) i båda temana — light-blocket
      // delas med adminens Ljus som numera kör Jakarta
      style={
        {
          "--font-display-theme": "var(--font-fraunces), Georgia, serif",
          "--font-display": "var(--font-fraunces), Georgia, serif",
        } as React.CSSProperties
      }
    >
      {/* Två block med gap — #050505 syns i ramen och mellan blocken */}
      <div
        className={`grid lg:grid-cols-[1fr_1fr] lg:gap-3 ${
          embedded ? "h-full" : "min-h-dvh lg:min-h-0 lg:h-full w-full"
        }`}
      >
      {/* Vänster: flödet */}
      <div
        className={`flex flex-col bg-[var(--w-bg)] lg:rounded-2xl lg:overflow-hidden ${embedded ? "min-h-0 h-full overflow-hidden" : "min-h-dvh lg:min-h-0 lg:h-full"}`}
      >
        <header className="px-7 pt-7 pb-5 border-b border-[var(--w-line)]">
          <div className="mx-auto w-full max-w-lg">
          <p className="text-[11px] uppercase tracking-[0.22em] text-[var(--w-muted)]">
            Boka bord
          </p>
          <h1 className="mt-1 text-2xl [font-family:var(--font-display),serif]">
            {name}
          </h1>
          <p
            className="mt-3 min-h-6 text-sm text-[var(--w-accent)] transition-opacity motion-safe:duration-300"
            aria-live="polite"
          >
            {sentence || " "}
          </p>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto px-7 py-6">
          <div className="mx-auto w-full max-w-lg">
          {step !== "start" &&
            step !== "done" &&
            !(step === "party" && !hasStart) && (
              <button
                onClick={goBack}
                className="mb-5 text-xs text-[var(--w-muted)] hover:text-[var(--w-ink)] focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-[var(--w-accent)] rounded"
              >
                ‹ Tillbaka
              </button>
            )}

          {step === "start" && (
            <StepShell label="Vad önskar du?">
              <div className="grid grid-cols-2 gap-2">
                {offerings.map((o) => (
                  <button
                    key={o.id}
                    onClick={() => {
                      setOffering(o);
                      setStep("party");
                    }}
                    className="group overflow-hidden rounded-lg border border-[var(--w-line)] bg-[var(--w-panel)] text-left transition-colors motion-safe:duration-150 hover:border-[var(--w-accent)] focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-[var(--w-accent)]"
                  >
                    {o.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element -- extern tenant-bild, okänd domän
                      <img
                        src={o.imageUrl}
                        alt=""
                        className="aspect-[5/3] w-full object-cover"
                      />
                    ) : (
                      <div className="flex aspect-[5/3] w-full items-end bg-[radial-gradient(140%_120%_at_20%_0%,#222222_0%,#151515_70%)] p-3">
                        <span className="text-3xl [font-family:var(--font-display),serif] text-[var(--w-accent)]/70">
                          {o.title.charAt(0)}
                        </span>
                      </div>
                    )}
                    <div className="p-3">
                      <p className="text-sm font-semibold leading-snug">
                        {o.title}
                      </p>
                      {o.description && (
                        <p className="mt-1 line-clamp-2 text-xs text-[var(--w-muted)]">
                          {o.description}
                        </p>
                      )}
                    </div>
                  </button>
                ))}
              </div>
              <button
                onClick={() => {
                  setOffering(null);
                  setStep("party");
                }}
                className="mt-3 w-full h-11 rounded-md border border-[var(--w-line)] text-sm text-[var(--w-muted)] hover:border-[var(--w-muted)] hover:text-[var(--w-ink)] transition-colors motion-safe:duration-150 focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-[var(--w-accent)]"
              >
                Annat — boka utan att välja sittning
              </button>
            </StepShell>
          )}

          {step === "party" && (
            <StepShell label="Hur många blir ni?">
              <div className="grid grid-cols-4 gap-2">
                {Array.from({ length: maxParty }, (_, i) => i + 1).map((n) => (
                  <ChoiceButton
                    key={n}
                    selected={party === n}
                    onClick={() => {
                      setParty(n);
                      setTime(null);
                      setStep("date");
                    }}
                  >
                    {n}
                  </ChoiceButton>
                ))}
              </div>
              <p className="mt-4 text-xs text-[var(--w-muted)]">
                Fler än {maxParty}? Mejla oss så ordnar vi det personligen.
              </p>
            </StepShell>
          )}

          {step === "date" && (
            <StepShell label="Vilken dag?">
              <Calendar
                monthOffset={monthOffset}
                onMonthChange={setMonthOffset}
                openDays={openDays}
                closedDates={closedDates}
                bookingStopDates={bookingStopDates}
                selected={date}
                onSelect={(d) => {
                  setDate(d);
                  setTime(null);
                  setStep("time");
                  if (party) loadSlots(d, party);
                }}
              />
            </StepShell>
          )}

          {step === "time" && (
            <StepShell label="Vilken tid?">
              {slots === null && !slotsError && (
                <p className="text-sm text-[var(--w-muted)]">Hämtar tider…</p>
              )}
              {slotsError && (
                <p className="text-sm text-[var(--w-accent)]">{slotsError}</p>
              )}
              {slots?.length === 0 && (
                <p className="text-sm text-[var(--w-muted)]">
                  Inga lediga tider den dagen — prova ett annat datum.
                </p>
              )}
              {slots && slots.length > 0 && (
                <div className="grid grid-cols-4 gap-2 font-mono text-sm">
                  {slots.map((t) => (
                    <ChoiceButton
                      key={t}
                      selected={time === t}
                      onClick={() => {
                        setTime(t);
                        setStep("details");
                      }}
                    >
                      {t}
                    </ChoiceButton>
                  ))}
                </div>
              )}
            </StepShell>
          )}

          {step === "details" && party && date && time && (
            <DetailsForm
              slug={slug}
              party={party}
              date={date}
              time={time}
              offeringTitle={offering?.title ?? null}
              onEditParty={() => setStep("party")}
              onConfirmed={(c) => {
                setConfirmation(c);
                setStep("done");
              }}
            />
          )}

          {step === "done" && confirmation && (
            <StepShell label="Bokningen är bekräftad">
              <div className="rounded-lg border border-[var(--w-line)] bg-[var(--w-panel)] p-5">
                <p className="text-lg [font-family:var(--font-display),serif]">
                  {`Ett bord för ${confirmation.partySize} · ${formatLong(confirmation.date)} · kl ${confirmation.time}`}
                </p>
                <p className="mt-2 text-sm text-[var(--w-muted)]">
                  Bord {confirmation.tableName} · bokningsnummer{" "}
                  <span className="font-mono">
                    {confirmation.bookingId.slice(0, 8)}
                  </span>
                </p>
              </div>
              <button
                onClick={() => {
                  setOffering(null);
                  setParty(null);
                  setDate(null);
                  setTime(null);
                  setConfirmation(null);
                  setStep(hasStart ? "start" : "party");
                }}
                className="mt-5 text-sm text-[var(--w-muted)] hover:text-[var(--w-ink)] focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-[var(--w-accent)] rounded"
              >
                Gör en ny bokning
              </button>
            </StepShell>
          )}
          </div>
        </div>

        <ChatPanel slug={slug} />
      </div>

      {/* Höger: restaurangpanel — config-driven */}
      <aside
        className="relative hidden lg:flex flex-col justify-between overflow-hidden p-12 lg:rounded-2xl bg-cover bg-center bg-[radial-gradient(120%_90%_at_70%_10%,var(--bg-hover)_0%,var(--bg-app)_60%)]"
        style={
          heroImageUrl
            ? {
                backgroundImage: `linear-gradient(to top, rgba(13,13,13,0.85) 0%, rgba(13,13,13,0.25) 60%), url(${heroImageUrl})`,
              }
            : undefined
        }
      >
        {logoUrl && (
          // eslint-disable-next-line @next/next/no-img-element -- tenant-logga från Storage
          <img
            src={logoUrl}
            alt={name}
            className="pointer-events-none absolute left-1/2 top-1/2 h-28 max-w-[400px] w-auto -translate-x-1/2 -translate-y-1/2 object-contain drop-shadow-lg"
          />
        )}
        <div className="self-end text-right">
          <p className="text-[11px] uppercase tracking-[0.22em] text-[var(--w-muted)]">
            Öppettider
          </p>
          <ul className="mt-2 space-y-1 text-sm text-[var(--w-muted)]">
            {hoursDisplay.map((h) => (
              <li key={h.day}>
                {h.day}{" "}
                <span className="font-mono text-[var(--w-ink)]">{h.hours}</span>
              </li>
            ))}
          </ul>
        </div>
        <div>
          {!logoUrl && (
            <p className="text-6xl xl:text-7xl leading-none [font-family:var(--font-display),serif] text-[var(--w-ink)]">
              {name}
            </p>
          )}
          {menu && (
            <p className="mt-6 max-w-md text-sm leading-relaxed text-[var(--w-muted)]">
              {menu}
            </p>
          )}
        </div>
      </aside>
      </div>
    </div>
  );
}

function StepShell({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h2 className="mb-4 text-[11px] uppercase tracking-[0.22em] text-[var(--w-muted)]">
        {label}
      </h2>
      {children}
    </section>
  );
}

function ChoiceButton({
  selected,
  onClick,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={selected}
      className={`h-12 rounded-md border text-sm transition-colors motion-safe:duration-150 focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-[var(--w-accent)] ${
        selected
          ? "border-[var(--w-accent)] bg-[var(--w-accent)]/10 text-[var(--w-accent)]"
          : "border-[var(--w-line)] bg-[var(--w-panel)] hover:border-[var(--w-muted)]"
      }`}
    >
      {children}
    </button>
  );
}

function Calendar({
  monthOffset,
  onMonthChange,
  openDays,
  closedDates,
  bookingStopDates,
  selected,
  onSelect,
}: {
  monthOffset: number;
  onMonthChange: (n: number) => void;
  openDays: string[];
  closedDates: string[];
  bookingStopDates: string[];
  selected: string | null;
  onSelect: (date: string) => void;
}) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const first = new Date(today.getFullYear(), today.getMonth() + monthOffset, 1);
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

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <button
          onClick={() => onMonthChange(monthOffset - 1)}
          disabled={monthOffset === 0}
          aria-label="Föregående månad"
          className="px-2 py-1 rounded text-[var(--w-muted)] hover:text-[var(--w-ink)] disabled:opacity-30 focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-[var(--w-accent)]"
        >
          ‹
        </button>
        <p className="text-sm capitalize">{monthLabel}</p>
        <button
          onClick={() => onMonthChange(monthOffset + 1)}
          disabled={monthOffset >= MONTHS_AHEAD - 1}
          aria-label="Nästa månad"
          className="px-2 py-1 rounded text-[var(--w-muted)] hover:text-[var(--w-ink)] disabled:opacity-30 focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-[var(--w-accent)]"
        >
          ›
        </button>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center text-[10px] uppercase tracking-wider text-[var(--w-muted)]">
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
          // Röda dagar + bokningsstopp släcks direkt i kalendern —
          // gästen ska inte mötas av spärren först efter datumval
          const closed =
            !openDays.includes(WEEKDAY_KEYS[d.getDay()]) ||
            closedDates.includes(dateStr) ||
            bookingStopDates.includes(dateStr);
          const past = d < today;
          const disabled = closed || past;
          return (
            <button
              key={dateStr}
              disabled={disabled}
              onClick={() => onSelect(dateStr)}
              aria-pressed={selected === dateStr}
              className={`h-9 rounded text-sm transition-colors motion-safe:duration-150 focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-[var(--w-accent)] ${
                disabled
                  ? "text-[var(--w-muted)]/40 cursor-default"
                  : selected === dateStr
                    ? "bg-[var(--w-accent)]/15 text-[var(--w-accent)] border border-[var(--w-accent)]"
                    : "hover:bg-[var(--w-panel)]"
              }`}
            >
              {i + 1}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function DetailsForm({
  slug,
  party,
  date,
  time,
  offeringTitle,
  onEditParty,
  onConfirmed,
}: {
  slug: string;
  party: number;
  date: string;
  time: string;
  offeringTitle: string | null;
  onEditParty: () => void;
  onConfirmed: (c: Confirmation) => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [children, setChildren] = useState(0);
  // Allergier är hälsouppgifter (GDPR art 9) — separat fält + aktivt samtycke
  const [allergies, setAllergies] = useState("");
  const [allergyConsent, setAllergyConsent] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    // E-post ELLER telefon krävs — namn är valfritt
    const phone = String(form.get("phone") ?? "").trim();
    const email = String(form.get("email") ?? "").trim();
    if (!phone && !email) {
      setError("Ange e-post eller telefonnummer.");
      return;
    }
    if (allergies.trim() && !allergyConsent) {
      setError(
        "Bekräfta samtycket för allergiuppgiften, eller lämna fältet tomt.",
      );
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/widget/${slug}/book`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date,
          time,
          partySize: party,
          childrenCount: children,
          name: String(form.get("name") ?? "").trim() || undefined,
          phone: String(form.get("phone") ?? "").trim() || undefined,
          email: String(form.get("email") ?? "").trim() || undefined,
          notes:
            [
              offeringTitle ? `Sittning: ${offeringTitle}` : null,
              String(form.get("wishes") ?? "").trim() || null,
            ]
              .filter(Boolean)
              .join(". ") || undefined,
          ...(allergies.trim()
            ? { allergies: allergies.trim(), allergyConsent }
            : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Bokningen misslyckades — prova igen.");
        return;
      }
      onConfirmed(data);
    } catch {
      setError("Något gick fel — prova igen.");
    } finally {
      setSubmitting(false);
    }
  }

  const inputClass =
    "w-full bg-transparent border-b border-[var(--w-line)] py-2 text-sm placeholder:text-[var(--w-muted)]/60 focus:border-[var(--w-accent)] focus:outline-none";

  return (
    <StepShell label="Dina uppgifter">
      <form onSubmit={handleSubmit} className="space-y-4">
        <input
          name="name"
          placeholder="Namn (valfritt)"
          autoComplete="name"
          className={inputClass}
        />
        <div className="grid grid-cols-2 gap-4">
          <input
            name="phone"
            placeholder="Telefon"
            autoComplete="tel"
            className={inputClass}
          />
          <input
            name="email"
            type="email"
            placeholder="E-post"
            autoComplete="email"
            className={inputClass}
          />
        </div>
        <p className="text-xs text-[var(--w-muted)]">
          Ange e-post eller telefonnummer så vi kan nå dig om bokningen.
        </p>
        {/* Totalen väljs i antalssteget; här anges hur många av dem som är barn */}
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span className="text-[var(--w-muted)]">
            Antal gäster:{" "}
            <span className="font-mono text-[var(--w-ink)]">{party}</span>
          </span>
          <button
            type="button"
            onClick={onEditParty}
            className="text-xs text-[var(--w-accent)] underline-offset-2 hover:underline"
          >
            Ändra
          </button>
          {party > 1 && (
            <span className="flex items-center gap-3">
              <span className="text-[var(--w-muted)]">— varav barn:</span>
              <button
                type="button"
                onClick={() => setChildren(Math.max(0, children - 1))}
                disabled={children <= 0}
                aria-label="Färre barn"
                className="h-8 w-8 rounded-lg border border-[var(--w-line)] disabled:opacity-30"
              >
                −
              </button>
              <span className="w-5 text-center font-mono">{children}</span>
              <button
                type="button"
                onClick={() => setChildren(Math.min(party, children + 1))}
                disabled={children >= party}
                aria-label="Fler barn"
                className="h-8 w-8 rounded-lg border border-[var(--w-line)] disabled:opacity-30"
              >
                +
              </button>
            </span>
          )}
        </div>
        <input
          name="wishes"
          placeholder="Önskemål — bordsplacering, barnstol… (valfritt)"
          className={inputClass}
        />
        <input
          value={allergies}
          onChange={(e) => {
            setAllergies(e.target.value);
            if (!e.target.value.trim()) setAllergyConsent(false);
          }}
          maxLength={300}
          placeholder="Allergier (valfritt)"
          className={inputClass}
        />
        {allergies.trim() && (
          <label className="flex items-start gap-2.5 text-xs leading-relaxed text-[var(--w-muted)]">
            <input
              type="checkbox"
              checked={allergyConsent}
              onChange={(e) => setAllergyConsent(e.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--w-accent)]"
            />
            <span>
              Jag godkänner att uppgiften om allergi används för att förbereda
              besöket. Den raderas efter genomfört besök.
            </span>
          </label>
        )}
        {error && <p className="text-sm text-[var(--w-accent)]">{error}</p>}
        <button
          type="submit"
          disabled={submitting}
          className="w-full h-12 rounded-md bg-[var(--w-accent)] text-accent-on text-sm font-medium tracking-wide hover:brightness-110 disabled:opacity-60 transition motion-safe:duration-150 focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--w-accent)]"
        >
          {submitting ? "Bokar…" : "Bekräfta bokningen"}
        </button>
        <p className="text-center text-xs text-[var(--w-muted)]">
          Genom att boka godkänner du vår{" "}
          <a
            href={`/widget/${slug}/integritetspolicy`}
            target="_blank"
            rel="noreferrer"
            className="font-semibold text-[var(--w-accent)] hover:text-[var(--w-accent)]/80 underline-offset-2 hover:underline"
          >
            integritetspolicy
          </a>
          .
        </p>
      </form>
    </StepShell>
  );
}

function ChatPanel({ slug }: { slug: string }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const threadRef = useRef<HTMLDivElement>(null);

  const send = useCallback(async () => {
    const question = input.trim();
    if (!question || busy) return;
    const next: ChatMessage[] = [...messages, { role: "user", content: question }];
    setMessages(next);
    setInput("");
    setBusy(true);
    try {
      const res = await fetch(`/api/widget/${slug}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: next.slice(-10) }),
      });
      const data = await res.json();
      setMessages([
        ...next,
        {
          role: "assistant",
          content: res.ok
            ? data.reply
            : (data.error ?? "Något gick fel — prova igen."),
        },
      ]);
    } catch {
      setMessages([
        ...next,
        { role: "assistant", content: "Något gick fel — prova igen." },
      ]);
    } finally {
      setBusy(false);
    }
  }, [input, busy, messages, slug]);

  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight });
  }, [messages]);

  return (
    <div className="border-t border-[var(--w-line)] px-7 py-4">
      <div className="mx-auto w-full max-w-lg">
      {messages.length > 0 && (
        <div
          ref={threadRef}
          className="mb-3 max-h-48 space-y-2 overflow-y-auto text-sm"
        >
          {messages.map((m, i) => (
            <p
              key={i}
              className={
                m.role === "user"
                  ? "text-[var(--w-ink)]"
                  : "text-[var(--w-muted)]"
              }
            >
              <span className="mr-2 text-[10px] uppercase tracking-wider text-[var(--w-muted)]/70">
                {m.role === "user" ? "Du" : "Värd"}
              </span>
              {m.content}
            </p>
          ))}
          {busy && <p className="text-[var(--w-muted)]">…</p>}
        </div>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
        className="flex items-center gap-2"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ställ en fråga — öppettider, meny, lediga bord…"
          aria-label="Ställ en fråga till restaurangen"
          className="flex-1 rounded-md border border-[var(--w-line)] bg-[var(--w-panel)] px-3 py-2.5 text-sm placeholder:text-[var(--w-muted)]/60 focus:border-[var(--w-accent)] focus:outline-none"
        />
        <button
          type="submit"
          disabled={busy || !input.trim()}
          aria-label="Skicka fråga"
          className="h-10 w-10 rounded-md border border-[var(--w-line)] text-[var(--w-accent)] hover:border-[var(--w-accent)] disabled:opacity-40 transition motion-safe:duration-150 focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-[var(--w-accent)]"
        >
          ↑
        </button>
      </form>
      </div>
    </div>
  );
}
