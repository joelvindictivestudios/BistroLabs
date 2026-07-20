"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { getBrowserSupabase } from "@/lib/auth/client";
import {
  CardFields,
  cardReady,
  type CardValue,
} from "@/app/components/card-fields";

// Bokningswidget: gäster → datum → tid → (konto) → uppgifter → (kort) →
// bekräftat. Kortsteget visas när restaurangen kräver kortgaranti (§3.1);
// kontovalet hoppar över för inloggade matgäster. Signaturen är meningen som
// byggs upp medan man väljer: "Ett bord för 2 · fre 10 juli · 19:00".

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
  /** No-show-skyddet (§2b) — styr kortsteget + policytexterna. */
  policy?: {
    noShowFeePerGuest: number;
    cancellationWindowHours: number;
    cardGuaranteeRequired: boolean;
  };
  /** Inloggad matgäst (kind: "guest") — hoppar kontovalssteget, prefyller. */
  diner?: { name: string; phone: string; email: string } | null;
};

type Step =
  | "start"
  | "party"
  | "date"
  | "time"
  | "account"
  | "login"
  | "details"
  | "card"
  | "done";

type Confirmation = {
  bookingId: string;
  tableName: string;
  date: string;
  time: string;
  partySize: number;
  cardLast4?: string | null;
  manageUrl?: string | null;
};

/** Uppgifterna som hålls mellan uppgifts- och kortsteget (§3.1). */
type GuestDetails = {
  name?: string;
  phone?: string;
  email?: string;
  children: number;
  notes?: string;
  allergies?: string;
  allergyConsent: boolean;
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

/** "19:00" → "20:00" — väntelistans önskeintervall runt en fullbokad tid. */
function plusOneHour(time: string): string {
  const [h, m] = time.split(":").map(Number);
  return `${String((h + 1) % 24).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
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
  policy,
  diner = null,
}: Props) {
  const hasStart = offerings.length > 0;
  const [step, setStep] = useState<Step>(hasStart ? "start" : "party");
  const [offering, setOffering] = useState<Offering | null>(null);
  const [party, setParty] = useState<number | null>(null);
  const [date, setDate] = useState<string | null>(null);
  const [time, setTime] = useState<string | null>(null);
  const [monthOffset, setMonthOffset] = useState(0);
  const [slots, setSlots] = useState<string[] | null>(null);
  const [fullSlots, setFullSlots] = useState<string[]>([]);
  const [slotsError, setSlotsError] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  // Uppgifterna hålls här mellan uppgifts- och kortsteget — POST sker vid
  // "Bekräfta bokning" i kortsteget (§3.1)
  const [details, setDetails] = useState<GuestDetails | null>(null);
  // Kontovalet (§3.1): "signup" ger lösenordsfältet i uppgiftsformuläret
  const [accountMode, setAccountMode] = useState<"guest" | "signup">("guest");
  const cardRequired = policy?.cardGuaranteeRequired ?? false;
  // Väntelistan (§3.8): CTA vid fullbokade tider → namn + mobil → i kön
  const [wl, setWl] = useState<{
    open: boolean;
    joined: boolean;
    name: string;
    phone: string;
    wish: string;
    error: string | null;
  }>({ open: false, joined: false, name: "", phone: "", wish: "", error: null });

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
      setFullSlots([]);
      setSlotsError(null);
      setWl({ open: false, joined: false, name: "", phone: "", wish: "", error: null });
      fetch(`/api/widget/${slug}/slots?date=${d}&party=${p}`)
        .then((r) => r.json())
        .then((data) => {
          if (requestId !== slotsRequestId.current) return;
          if (data.blockedReason) {
            setSlots([]);
            setSlotsError(data.blockedReason);
          } else if (Array.isArray(data.slots)) {
            setSlots(data.slots);
            setFullSlots(Array.isArray(data.fullSlots) ? data.fullSlots : []);
          } else setSlotsError(data.error ?? "Kunde inte hämta tider");
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
    else if (step === "account") setStep("time");
    else if (step === "login") setStep("account");
    else if (step === "details") setStep(diner ? "time" : "account");
    else if (step === "card") setStep("details");
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
              {slots?.length === 0 && !slotsError && (
                <p className="text-sm text-[var(--w-muted)]">
                  Inga lediga tider den dagen — prova ett annat datum
                  {fullSlots.length > 0 ? " eller ställ dig på väntelistan" : ""}.
                </p>
              )}
              {slots && (slots.length > 0 || fullSlots.length > 0) && (
                <div className="grid grid-cols-4 gap-2 font-mono text-sm">
                  {[...slots, ...fullSlots].sort().map((t) => {
                    const full = !slots.includes(t);
                    if (full) {
                      // Fullbokad tid: gråad + öppnar väntelisteformen (§3.8)
                      return (
                        <button
                          key={t}
                          type="button"
                          onClick={() =>
                            setWl((s) => ({
                              ...s,
                              open: true,
                              wish: `${t}–${plusOneHour(t)}`,
                              error: null,
                            }))
                          }
                          className="rounded-lg border border-[var(--w-line)] px-2 py-2.5 text-[var(--w-muted)]/40 line-through decoration-1 hover:border-[var(--w-muted)] transition"
                          title="Fullbokat — ställ dig på väntelistan"
                        >
                          {t}
                        </button>
                      );
                    }
                    return (
                      <ChoiceButton
                        key={t}
                        selected={time === t}
                        onClick={() => {
                          setTime(t);
                          // Inloggad matgäst hoppar kontovalet (§3.1)
                          setStep(diner ? "details" : "account");
                        }}
                      >
                        {t}
                      </ChoiceButton>
                    );
                  })}
                </div>
              )}

              {/* Väntelistans CTA (§3.8) */}
              {fullSlots.length > 0 && !wl.joined && !wl.open && (
                <div className="mt-4 flex items-center justify-between gap-3 rounded-xl border border-[var(--w-line)] bg-[var(--w-panel)] px-4 py-3">
                  <span className="text-xs text-[var(--w-muted)]">
                    Önskad tid fullbokad? Vi hör av oss om ett bord blir
                    ledigt.
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      setWl((s) => ({
                        ...s,
                        open: true,
                        wish: `${fullSlots[0]}–${plusOneHour(fullSlots[fullSlots.length - 1])}`,
                        error: null,
                      }))
                    }
                    className="shrink-0 rounded-lg border border-[var(--w-accent)]/50 px-3 py-2 text-xs font-semibold text-[var(--w-accent)] hover:bg-[var(--w-accent)]/10 transition"
                  >
                    Ställ mig på väntelistan
                  </button>
                </div>
              )}
              {wl.open && !wl.joined && party && date && (
                <div className="mt-4 rounded-xl border border-[var(--w-line)] bg-[var(--w-panel)] p-4">
                  <p className="text-sm font-semibold">
                    Väntelista · {wl.wish}
                  </p>
                  <p className="mt-0.5 text-xs text-[var(--w-muted)]">
                    Vi skickar SMS om ett bord för {party}{" "}
                    {party === 1 ? "gäst" : "gäster"} blir ledigt.
                  </p>
                  <div className="mt-3 grid grid-cols-[1fr_1fr_auto] gap-2">
                    <input
                      value={wl.name}
                      onChange={(e) =>
                        setWl((s) => ({ ...s, name: e.target.value }))
                      }
                      placeholder="Namn"
                      className="w-full bg-transparent border-b border-[var(--w-line)] py-2 text-sm placeholder:text-[var(--w-muted)]/60 focus:border-[var(--w-accent)] focus:outline-none"
                    />
                    <input
                      value={wl.phone}
                      onChange={(e) =>
                        setWl((s) => ({ ...s, phone: e.target.value }))
                      }
                      placeholder="Mobilnummer"
                      inputMode="tel"
                      className="w-full bg-transparent border-b border-[var(--w-line)] py-2 text-sm placeholder:text-[var(--w-muted)]/60 focus:border-[var(--w-accent)] focus:outline-none"
                    />
                    <button
                      type="button"
                      disabled={
                        !wl.name.trim() || wl.phone.trim().length < 5
                      }
                      onClick={() => {
                        const [from, to] = wl.wish.split("–");
                        void fetch(`/api/widget/${slug}/waitlist`, {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({
                            name: wl.name.trim(),
                            phone: wl.phone.trim(),
                            partySize: party,
                            date,
                            wishedFrom: from,
                            wishedTo: to,
                          }),
                        })
                          .then(async (r) => {
                            const d = await r.json();
                            if (!r.ok) {
                              setWl((s) => ({
                                ...s,
                                error: d.error ?? "Kunde inte ställa dig i kö.",
                              }));
                              return;
                            }
                            setWl((s) => ({ ...s, joined: true, open: false }));
                          })
                          .catch(() =>
                            setWl((s) => ({
                              ...s,
                              error: "Kunde inte ställa dig i kö.",
                            })),
                          );
                      }}
                      className="shrink-0 rounded-lg bg-[var(--w-accent)] px-3 py-2 text-xs font-semibold text-[#141210] hover:brightness-110 disabled:opacity-50 transition"
                    >
                      Ställ mig i kö
                    </button>
                  </div>
                  {wl.error && (
                    <p className="mt-2 text-xs text-yellow-400">{wl.error}</p>
                  )}
                </div>
              )}
              {wl.joined && (
                <div className="mt-4 flex items-center gap-2 rounded-xl border border-emerald-500/40 bg-[var(--w-panel)] px-4 py-3 text-xs font-semibold text-emerald-400">
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M20 6 9 17l-5-5" />
                  </svg>
                  Du står på väntelistan — vi SMS:ar om ett bord blir ledigt.
                  Du kan även boka en annan tid ovan.
                </div>
              )}
            </StepShell>
          )}

          {/* Kontovalet (§3.1): logga in / skapa konto / fortsätt som gäst */}
          {step === "account" && (
            <StepShell label="Hur vill du fortsätta?">
              <div className="space-y-2.5">
                <button
                  type="button"
                  onClick={() => setStep("login")}
                  className="flex w-full items-center justify-between rounded-xl border border-[var(--w-line)] bg-[var(--w-panel)] px-4 py-3.5 text-left hover:border-[var(--w-muted)] transition"
                >
                  <span>
                    <span className="block text-sm font-semibold">
                      Logga in
                    </span>
                    <span className="mt-0.5 block text-xs text-[var(--w-muted)]">
                      Har du redan ett konto hos oss?
                    </span>
                  </span>
                  <span aria-hidden className="text-[var(--w-muted)]">
                    ›
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setAccountMode("signup");
                    setStep("details");
                  }}
                  className="flex w-full items-center justify-between rounded-xl border border-[var(--w-line)] bg-[var(--w-panel)] px-4 py-3.5 text-left hover:border-[var(--w-muted)] transition"
                >
                  <span>
                    <span className="block text-sm font-semibold">
                      Skapa konto
                    </span>
                    <span className="mt-0.5 block text-xs text-[var(--w-muted)]">
                      Spara dina uppgifter till nästa besök
                    </span>
                  </span>
                  <span aria-hidden className="text-[var(--w-muted)]">
                    ›
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setAccountMode("guest");
                    setStep("details");
                  }}
                  className="flex w-full items-center justify-between rounded-xl border border-dashed border-[var(--w-line)] px-4 py-3.5 text-left hover:border-[var(--w-muted)] transition"
                >
                  <span>
                    <span className="block text-sm font-semibold">
                      Fortsätt som gäst
                    </span>
                    <span className="mt-0.5 block text-xs text-[var(--w-muted)]">
                      Boka utan konto
                    </span>
                  </span>
                  <span aria-hidden className="text-[var(--w-muted)]">
                    ›
                  </span>
                </button>
              </div>
            </StepShell>
          )}

          {step === "login" && (
            <LoginStep onDone={() => setStep("details")} />
          )}

          {step === "details" && party && date && time && (
            <DetailsForm
              slug={slug}
              party={party}
              date={date}
              time={time}
              offeringTitle={offering?.title ?? null}
              signup={accountMode === "signup" && !diner}
              diner={diner}
              cardRequired={cardRequired}
              onEditParty={() => setStep("party")}
              onContinue={(g) => {
                setDetails(g);
                setStep("card");
              }}
              onConfirmed={(c) => {
                setConfirmation(c);
                setStep("done");
              }}
            />
          )}

          {/* Kortsteget (§3.1): kort som garanti — inget dras nu */}
          {step === "card" && party && date && time && details && policy && (
            <CardStep
              slug={slug}
              party={party}
              date={date}
              time={time}
              details={details}
              policy={policy}
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
                {confirmation.cardLast4 && (
                  <p className="mt-1 text-sm text-[var(--w-muted)]">
                    Kortgaranti{" "}
                    <span className="font-mono">
                      •••• {confirmation.cardLast4}
                    </span>{" "}
                    — inget har dragits.
                  </p>
                )}
              </div>
              {confirmation.manageUrl && policy && (
                <p className="mt-4 text-xs leading-relaxed text-[var(--w-muted)]">
                  Behöver du ändra eller avboka? Använd länken i
                  bekräftelsemejlet — kostnadsfritt fram till{" "}
                  {policy.cancellationWindowHours} timmar före ankomst.{" "}
                  <a
                    href={confirmation.manageUrl}
                    className="font-semibold text-[var(--w-accent)] underline-offset-2 hover:underline"
                  >
                    Hantera din bokning
                  </a>
                </p>
              )}
              <button
                onClick={() => {
                  setOffering(null);
                  setParty(null);
                  setDate(null);
                  setTime(null);
                  setConfirmation(null);
                  setDetails(null);
                  setAccountMode("guest");
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
  signup,
  diner,
  cardRequired,
  onEditParty,
  onContinue,
  onConfirmed,
}: {
  slug: string;
  party: number;
  date: string;
  time: string;
  offeringTitle: string | null;
  /** "Skapa konto"-varianten: lösenordsfält + konto skapas före bokningen. */
  signup: boolean;
  /** Inloggad matgäst — prefyller fälten. */
  diner: { name: string; phone: string; email: string } | null;
  /** Kortgaranti på: uppgifterna hålls och POST sker i kortsteget (§3.1). */
  cardRequired: boolean;
  onEditParty: () => void;
  onContinue: (g: GuestDetails) => void;
  onConfirmed: (c: Confirmation) => void;
}) {
  const router = useRouter();
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
    const name = String(form.get("name") ?? "").trim();
    const phone = String(form.get("phone") ?? "").trim();
    const email = String(form.get("email") ?? "").trim();
    const password = String(form.get("password") ?? "");
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
    if (signup) {
      if (!email) {
        setError("E-post krävs för att skapa konto.");
        return;
      }
      if (!name) {
        setError("Ange ditt namn för kontot.");
        return;
      }
      if (password.length < 8) {
        setError("Lösenordet behöver minst 8 tecken.");
        return;
      }
    }
    setSubmitting(true);
    setError(null);
    try {
      // "Skapa konto" (§3.1): kontot skapas först, sen loggas gästen in —
      // bokningen fortsätter oavsett om inloggningen skulle stanna
      if (signup) {
        const res = await fetch("/api/guest/signup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name,
            ...(phone ? { phone } : {}),
            email,
            password,
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          setError(data.error ?? "Kontot kunde inte skapas — prova igen.");
          return;
        }
        const supabase = getBrowserSupabase();
        await supabase.auth.signInWithPassword({ email, password });
      }

      const notes =
        [
          offeringTitle ? `Sittning: ${offeringTitle}` : null,
          String(form.get("wishes") ?? "").trim() || null,
        ]
          .filter(Boolean)
          .join(". ") || undefined;
      const guestDetails: GuestDetails = {
        name: name || undefined,
        phone: phone || undefined,
        email: email || undefined,
        children,
        notes,
        ...(allergies.trim()
          ? { allergies: allergies.trim(), allergyConsent }
          : { allergyConsent: false }),
      };

      // Kortgaranti på: uppgifterna hålls i state, POST sker i kortsteget
      if (cardRequired) {
        onContinue(guestDetails);
        return;
      }

      const res = await fetch(`/api/widget/${slug}/book`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date,
          time,
          partySize: party,
          childrenCount: children,
          name: guestDetails.name,
          phone: guestDetails.phone,
          email: guestDetails.email,
          notes,
          ...(guestDetails.allergies
            ? {
                allergies: guestDetails.allergies,
                allergyConsent: guestDetails.allergyConsent,
              }
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

  async function logOut() {
    const supabase = getBrowserSupabase();
    await supabase.auth.signOut();
    router.refresh();
  }

  const inputClass =
    "w-full bg-transparent border-b border-[var(--w-line)] py-2 text-sm placeholder:text-[var(--w-muted)]/60 focus:border-[var(--w-accent)] focus:outline-none";

  return (
    <StepShell label={signup ? "Skapa ditt konto" : "Dina uppgifter"}>
      <form onSubmit={handleSubmit} className="space-y-4">
        {diner && (
          <div className="flex items-center justify-between rounded-lg border border-[var(--w-line)] bg-[var(--w-panel)] px-3 py-2 text-xs">
            <span className="text-[var(--w-muted)]">
              Inloggad som{" "}
              <span className="font-semibold text-[var(--w-ink)]">
                {diner.name || diner.email}
              </span>
            </span>
            <button
              type="button"
              onClick={() => void logOut()}
              className="font-semibold text-[var(--w-accent)] underline-offset-2 hover:underline"
            >
              Logga ut
            </button>
          </div>
        )}
        <input
          name="name"
          placeholder={signup ? "Namn" : "Namn (valfritt)"}
          autoComplete="name"
          defaultValue={diner?.name ?? ""}
          className={inputClass}
        />
        <div className="grid grid-cols-2 gap-4">
          <input
            name="phone"
            placeholder="Telefon"
            autoComplete="tel"
            defaultValue={diner?.phone ?? ""}
            className={inputClass}
          />
          <input
            name="email"
            type="email"
            placeholder="E-post"
            autoComplete="email"
            defaultValue={diner?.email ?? ""}
            className={inputClass}
          />
        </div>
        <p className="text-xs text-[var(--w-muted)]">
          Ange e-post eller telefonnummer så vi kan nå dig om bokningen.
        </p>
        {signup && (
          <input
            name="password"
            type="password"
            placeholder="Skapa lösenord (minst 8 tecken)"
            autoComplete="new-password"
            className={inputClass}
          />
        )}
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
          {submitting
            ? cardRequired
              ? "Sparar…"
              : "Bokar…"
            : cardRequired
              ? "Fortsätt till kort"
              : "Bekräfta bokningen"}
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

function LoginStep({ onDone }: { onDone: () => void }) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputClass =
    "w-full bg-transparent border-b border-[var(--w-line)] py-2 text-sm placeholder:text-[var(--w-muted)]/60 focus:border-[var(--w-accent)] focus:outline-none";

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setSubmitting(true);
    setError(null);
    const supabase = getBrowserSupabase();
    const { error: authError } = await supabase.auth.signInWithPassword({
      email: String(form.get("email") ?? ""),
      password: String(form.get("password") ?? ""),
    });
    setSubmitting(false);
    if (authError) {
      setError(
        authError.message === "Invalid login credentials"
          ? "Fel e-post eller lösenord."
          : authError.message,
      );
      return;
    }
    // Servern läser sessionen och prefyller uppgifterna vid nästa render
    router.refresh();
    onDone();
  }

  return (
    <StepShell label="Logga in">
      <form onSubmit={handleSubmit} className="space-y-4">
        <p className="text-xs text-[var(--w-muted)]">
          Logga in för att boka snabbare med sparade uppgifter.
        </p>
        <input
          name="email"
          type="email"
          placeholder="E-post"
          autoComplete="email"
          required
          className={inputClass}
        />
        <input
          name="password"
          type="password"
          placeholder="Lösenord"
          autoComplete="current-password"
          required
          className={inputClass}
        />
        {error && <p className="text-sm text-[var(--w-accent)]">{error}</p>}
        <button
          type="submit"
          disabled={submitting}
          className="w-full h-12 rounded-md bg-[var(--w-accent)] text-accent-on text-sm font-medium tracking-wide hover:brightness-110 disabled:opacity-60 transition"
        >
          {submitting ? "Loggar in…" : "Logga in och fortsätt"}
        </button>
      </form>
    </StepShell>
  );
}

// Kortsteget (§3.1): kortet registreras som garanti — inget dras nu.
// Bokningen skapas först här ("Bekräfta bokning") med de hållna uppgifterna.
function CardStep({
  slug,
  party,
  date,
  time,
  details,
  policy,
  onConfirmed,
}: {
  slug: string;
  party: number;
  date: string;
  time: string;
  details: GuestDetails;
  policy: {
    noShowFeePerGuest: number;
    cancellationWindowHours: number;
    cardGuaranteeRequired: boolean;
  };
  onConfirmed: (c: Confirmation) => void;
}) {
  const [card, setCard] = useState<CardValue>({ number: "", exp: "", cvc: "" });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setSubmitting(true);
    setError(null);
    try {
      const expMatch = card.exp.match(/^(\d{1,2})\s*\/\s*(\d{2}|\d{4})$/);
      if (!expMatch) {
        setError("Ange giltighetstid som MM/ÅÅ.");
        return;
      }
      const res = await fetch(`/api/widget/${slug}/book`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date,
          time,
          partySize: party,
          childrenCount: details.children,
          name: details.name,
          phone: details.phone,
          email: details.email,
          notes: details.notes,
          ...(details.allergies
            ? {
                allergies: details.allergies,
                allergyConsent: details.allergyConsent,
              }
            : {}),
          card: {
            number: card.number,
            expMonth: Number(expMatch[1]),
            expYear: Number(expMatch[2]),
            cvc: card.cvc,
          },
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

  return (
    <StepShell label="Bekräfta med kort">
      <p className="text-xs text-[var(--w-muted)]">
        Inget dras nu — kortet är endast en garanti vid utebliven ankomst.
      </p>
      <div className="mt-4">
        <CardFields value={card} onChange={setCard} disabled={submitting} />
      </div>
      <p className="mt-4 rounded-lg border border-[var(--w-line)] bg-[var(--w-panel)] px-3 py-2.5 text-xs leading-relaxed text-[var(--w-muted)]">
        Avboka kostnadsfritt fram till {policy.cancellationWindowHours} timmar
        före ankomst. Vid no-show debiteras{" "}
        <b className="text-[var(--w-ink)]">
          {policy.noShowFeePerGuest} kr per gäst
        </b>{" "}
        ({(policy.noShowFeePerGuest * party).toLocaleString("sv-SE")} kr för
        ert sällskap). Bokningen bekräftas automatiskt när kortet
        registrerats.
      </p>
      {error && <p className="mt-3 text-sm text-[var(--w-accent)]">{error}</p>}
      <button
        type="button"
        onClick={() => void submit()}
        disabled={!cardReady(card) || submitting}
        className="mt-4 w-full h-12 rounded-md bg-[var(--w-accent)] text-accent-on text-sm font-medium tracking-wide hover:brightness-110 disabled:opacity-50 transition"
      >
        {submitting ? "Bokar…" : "Bekräfta bokning"}
      </button>
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
