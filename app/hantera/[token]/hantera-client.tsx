"use client";

import { useCallback, useEffect, useState } from "react";
import {
  CardFields,
  cardReady,
  parseExpiry,
  type CardValue,
} from "@/app/components/card-fields";

// "Hantera din bokning" (§3.6): omboka, ändra antal, allergier, meddelande,
// avboka kostnadsfritt — samt kortsteget för preliminära bokningar (§3.3).
// Inom avbokningsfönstret stängs allt och telefonnumret visas istället.

type Policy = {
  noShowFeePerGuest: number;
  cancellationWindowHours: number;
  cardGuaranteeRequired: boolean;
};

type Props = {
  token: string;
  slug: string;
  restaurantName: string;
  phone: string | null;
  status: "PENDING" | "CONFIRMED" | "CANCELLED" | "DONE";
  initialDate: string;
  initialTime: string;
  initialParty: number;
  initialAllergy: string;
  cardLast4: string | null;
  guestName: string | null;
  policy: Policy;
  withinWindow: boolean;
  deadlineText: string | null;
  openDays: { value: string; label: string }[];
  maxParty: number;
};

const selectClass =
  "w-full rounded-lg border border-[var(--w-line)] bg-[var(--w-panel)] px-3 py-2.5 text-sm focus:border-[var(--w-accent)] focus:outline-none";
const inputClass =
  "w-full bg-transparent border-b border-[var(--w-line)] py-2.5 text-sm placeholder:text-[var(--w-muted)]/60 focus:border-[var(--w-accent)] focus:outline-none";
const labelClass = "text-xs text-[var(--w-muted)]";

export function HanteraClient(props: Props) {
  const { token, slug, policy } = props;

  const [status, setStatus] = useState(props.status);
  const [cardLast4, setCardLast4] = useState(props.cardLast4);
  const [date, setDate] = useState(props.initialDate);
  const [time, setTime] = useState(props.initialTime);
  const [party, setParty] = useState(props.initialParty);
  const [allergy, setAllergy] = useState(props.initialAllergy);
  const [allergyConsent, setAllergyConsent] = useState(
    props.initialAllergy !== "",
  );
  const [message, setMessage] = useState("");
  const [saved, setSaved] = useState<{ date: string; time: string; party: number }>(
    { date: props.initialDate, time: props.initialTime, party: props.initialParty },
  );
  const [timeOptions, setTimeOptions] = useState<string[]>([props.initialTime]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<string | null>(null);
  const [cancelArmed, setCancelArmed] = useState(false);
  const [card, setCard] = useState<CardValue>({ number: "", exp: "", cvc: "" });
  const [cardBusy, setCardBusy] = useState(false);
  const [cardError, setCardError] = useState<string | null>(null);
  const [cardDone, setCardDone] = useState(false);

  const loadSlots = useCallback(
    async (d: string, p: number) => {
      try {
        const res = await fetch(
          `/api/widget/${slug}/slots?date=${d}&party=${p}&manage=${encodeURIComponent(token)}`,
        );
        const data = await res.json();
        const slots: string[] = data.slots ?? [];
        // Bokningens egen tid ska alltid gå att behålla på sin egen dag
        if (d === saved.date && !slots.includes(saved.time)) {
          slots.push(saved.time);
          slots.sort();
        }
        setTimeOptions(slots);
        setTime((t) => (slots.includes(t) ? t : (slots[0] ?? "")));
      } catch {
        setTimeOptions([saved.time]);
      }
    },
    [slug, token, saved.date, saved.time],
  );

  useEffect(() => {
    if (status !== "PENDING" && status !== "CONFIRMED") return;
    const id = setTimeout(() => void loadSlots(date, party), 0);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, party, status]);

  const touch = () => {
    setReceipt(null);
    setError(null);
  };

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {};
      if (date !== saved.date || time !== saved.time) {
        body.date = date;
        body.time = time;
      }
      if (party !== saved.party) body.partySize = party;
      if (allergy.trim() !== props.initialAllergy) {
        body.allergies = allergy.trim() || null;
        if (allergy.trim()) body.allergyConsent = allergyConsent;
      }
      if (message.trim()) body.message = message.trim();
      if (Object.keys(body).length === 0) {
        setReceipt("Inga ändringar att spara.");
        return;
      }
      const res = await fetch(`/api/hantera/${token}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Kunde inte spara — prova igen.");
        return;
      }
      setSaved({ date, time, party });
      setMessage("");
      setReceipt("Ändringarna är sparade — restaurangen har meddelats.");
    } catch {
      setError("Något gick fel — prova igen.");
    } finally {
      setBusy(false);
    }
  }

  async function cancelBooking() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/hantera/${token}/avboka`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Kunde inte avboka — prova igen.");
        setCancelArmed(false);
        return;
      }
      setStatus("CANCELLED");
    } catch {
      setError("Något gick fel — prova igen.");
    } finally {
      setBusy(false);
    }
  }

  async function submitCard() {
    setCardBusy(true);
    setCardError(null);
    try {
      const { expMonth, expYear } = parseExpiry(card.exp);
      const res = await fetch(`/api/hantera/${token}/kort`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          number: card.number,
          expMonth,
          expYear,
          cvc: card.cvc,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setCardError(data.error ?? "Kortet kunde inte registreras.");
        return;
      }
      setCard({ number: "", exp: "", cvc: "" });
      setCardLast4(data.cardLast4 ?? null);
      setStatus("CONFIRMED");
      setCardDone(true);
    } catch {
      setCardError("Något gick fel — prova igen.");
    } finally {
      setCardBusy(false);
    }
  }

  // --- Avbokad ---
  if (status === "CANCELLED") {
    return (
      <div className="text-center">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full border border-[var(--w-line)] bg-[var(--w-panel)]">
          <svg
            width="26"
            height="26"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            className="text-[var(--w-muted)]"
          >
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </div>
        <h1 className="mt-5 text-3xl [font-family:var(--font-display),serif]">
          Bokningen är avbokad
        </h1>
        <p className="mx-auto mt-3 max-w-sm text-sm leading-relaxed text-[var(--w-muted)]">
          Avbokningen skedde i tid — ingen avgift debiteras och kortgarantin är
          släppt. En bekräftelse har skickats via e-post.
        </p>
      </div>
    );
  }

  const summary = `${party} ${party === 1 ? "gäst" : "gäster"} · ${date} · kl ${time}${
    cardLast4 ? ` · Kort •••• ${cardLast4}` : ""
  }`;

  // --- Genomförd/pågående — endast läsning ---
  if (status === "DONE") {
    return (
      <div>
        <p className="text-[11px] uppercase tracking-[0.22em] text-[var(--w-muted)]">
          {props.restaurantName}
        </p>
        <h1 className="mt-1 text-3xl [font-family:var(--font-display),serif]">
          Din bokning
        </h1>
        <p className="mt-3 text-sm text-[var(--w-muted)]">{summary}</p>
        <p className="mt-6 text-sm leading-relaxed text-[var(--w-muted)]">
          Bokningen är avslutad och kan inte längre ändras via länken. Kontakta
          restaurangen om något inte stämmer.
        </p>
      </div>
    );
  }

  return (
    <div>
      <p className="text-[11px] uppercase tracking-[0.22em] text-[var(--w-muted)]">
        {props.restaurantName}
      </p>
      <h1 className="mt-1 text-3xl [font-family:var(--font-display),serif]">
        Hantera din bokning
      </h1>
      <p className="mt-3 text-sm text-[var(--w-muted)]">{summary}</p>

      {/* Inom fönstret: allt stängt, visa telefon (§3.6 sista stycket) */}
      {props.withinWindow ? (
        <div className="mt-8 rounded-2xl border border-[var(--w-line)] bg-[var(--w-panel)] p-5">
          <p className="text-sm leading-relaxed text-[var(--w-muted)]">
            Mindre än {policy.cancellationWindowHours} timmar till ankomst —
            ändringar och avbokning via länken är stängda.
            {props.phone
              ? ` Ring oss på ${props.phone} så hjälper vi dig.`
              : " Kontakta restaurangen så hjälper vi dig."}
          </p>
        </div>
      ) : (
        <>
          {/* Kortsteget för preliminära bokningar (§3.3) */}
          {status === "PENDING" && !cardDone && (
            <div className="mt-8 rounded-2xl border border-yellow-500/40 bg-[var(--w-panel)] p-5">
              <h2 className="text-base font-semibold">Ange kort och bekräfta</h2>
              <p className="mt-1 text-sm text-[var(--w-muted)]">
                Inget dras nu — kortet är endast en garanti vid utebliven
                ankomst.
              </p>
              {props.deadlineText && (
                <p className="mt-3 text-xs font-semibold text-yellow-400">
                  Utan kortbekräftelse avbokas bokningen automatiskt kl{" "}
                  {props.deadlineText} ({policy.cancellationWindowHours} tim
                  före ankomst).
                </p>
              )}
              <div className="mt-4">
                <CardFields value={card} onChange={setCard} disabled={cardBusy} />
              </div>
              <p className="mt-4 text-xs leading-relaxed text-[var(--w-muted)]">
                Avboka kostnadsfritt fram till {policy.cancellationWindowHours}{" "}
                timmar före ankomst. Vid no-show debiteras{" "}
                <b>{policy.noShowFeePerGuest} kr per gäst</b> (
                {(policy.noShowFeePerGuest * party).toLocaleString("sv-SE")} kr
                för ert sällskap). Bokningen bekräftas automatiskt när kortet
                registrerats.
              </p>
              {cardError && (
                <p className="mt-3 text-xs text-yellow-400">{cardError}</p>
              )}
              <button
                onClick={submitCard}
                disabled={!cardReady(card) || cardBusy}
                className="mt-4 h-11 w-full rounded-xl bg-[var(--w-accent)] text-sm font-semibold text-[#141210] shadow-lg shadow-black/25 hover:brightness-110 disabled:opacity-50 transition"
              >
                {cardBusy ? "Registrerar…" : "Bekräfta bokning"}
              </button>
            </div>
          )}
          {cardDone && (
            <div className="mt-8 flex items-center gap-2 rounded-2xl border border-emerald-500/40 bg-[var(--w-panel)] p-4 text-sm font-semibold text-emerald-400">
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M20 6 9 17l-5-5" />
              </svg>
              Kortet är registrerat — bokningen är bekräftad.
            </div>
          )}

          {/* Ändringsformen */}
          <div className="mt-8 space-y-5">
            {receipt && (
              <div className="flex items-center gap-2 rounded-xl border border-emerald-500/40 bg-[var(--w-panel)] px-4 py-3 text-sm font-semibold text-emerald-400">
                <svg
                  width="15"
                  height="15"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M20 6 9 17l-5-5" />
                </svg>
                {receipt}
              </div>
            )}
            <div className="grid grid-cols-2 gap-4">
              <label className="block">
                <span className={labelClass}>Datum</span>
                <select
                  value={date}
                  onChange={(e) => {
                    touch();
                    setDate(e.target.value);
                  }}
                  className={`mt-1 ${selectClass}`}
                >
                  {props.openDays.map((d) => (
                    <option key={d.value} value={d.value}>
                      {d.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className={labelClass}>Tid</span>
                <select
                  value={time}
                  onChange={(e) => {
                    touch();
                    setTime(e.target.value);
                  }}
                  className={`mt-1 ${selectClass}`}
                >
                  {timeOptions.length === 0 && (
                    <option value="">Fullbokat</option>
                  )}
                  {timeOptions.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div>
              <span className={labelClass}>Antal gäster</span>
              <div className="mt-2 grid grid-cols-6 gap-2">
                {Array.from({ length: Math.min(props.maxParty, 6) }, (_, i) => i + 1).map(
                  (n) => (
                    <button
                      key={n}
                      type="button"
                      aria-pressed={party === n}
                      onClick={() => {
                        touch();
                        setParty(n);
                      }}
                      className={`h-11 rounded-lg border text-sm font-semibold transition-colors ${
                        party === n
                          ? "border-[var(--w-accent)] bg-[var(--w-accent)]/15 text-[var(--w-ink)]"
                          : "border-[var(--w-line)] text-[var(--w-muted)] hover:border-[var(--w-muted)]"
                      }`}
                    >
                      {n}
                    </button>
                  ),
                )}
              </div>
            </div>
            <label className="block">
              <span className={labelClass}>Allergier i sällskapet</span>
              <input
                value={allergy}
                onChange={(e) => {
                  touch();
                  setAllergy(e.target.value);
                }}
                placeholder="T.ex. nötter, gluten, laktos"
                className={inputClass}
              />
            </label>
            {allergy.trim() !== "" &&
              allergy.trim() !== props.initialAllergy && (
                <label className="flex items-start gap-2 text-xs text-[var(--w-muted)]">
                  <input
                    type="checkbox"
                    checked={allergyConsent}
                    onChange={(e) => setAllergyConsent(e.target.checked)}
                    className="mt-0.5 accent-[var(--w-accent)]"
                  />
                  Jag godkänner att uppgiften om allergi används för att
                  förbereda besöket. Den raderas efter genomfört besök.
                </label>
              )}
            <label className="block">
              <span className={labelClass}>Meddelande till restaurangen</span>
              <textarea
                value={message}
                onChange={(e) => {
                  touch();
                  setMessage(e.target.value);
                }}
                rows={2}
                placeholder="Önskemål, tillfälle, barnstol …"
                className={`${inputClass} resize-y`}
              />
            </label>
            {error && <p className="text-xs text-yellow-400">{error}</p>}
            <button
              onClick={save}
              disabled={busy || (timeOptions.length === 0 && time === "")}
              className="h-11 w-full rounded-xl bg-[var(--w-accent)] text-sm font-semibold text-[#141210] shadow-lg shadow-black/25 hover:brightness-110 disabled:opacity-50 transition"
            >
              {busy ? "Sparar…" : "Spara ändringar"}
            </button>
          </div>

          {/* Avboka (§3.6) */}
          <div className="mt-8 rounded-2xl border border-[var(--w-line)] p-5">
            <h2 className="text-sm font-semibold">Avboka bokningen</h2>
            <p className="mt-1 text-xs leading-relaxed text-[var(--w-muted)]">
              Kostnadsfritt fram till {policy.cancellationWindowHours} timmar
              före ankomst
              {policy.cardGuaranteeRequired
                ? ` — därefter debiteras no-show-avgiften (${policy.noShowFeePerGuest} kr per gäst). Kortgarantin släpps direkt vid avbokning.`
                : "."}
            </p>
            {cancelArmed ? (
              <div className="mt-3 flex items-center gap-2">
                <button
                  onClick={cancelBooking}
                  disabled={busy}
                  className="h-11 flex-1 rounded-xl bg-[#b5503f] text-sm font-semibold text-white hover:brightness-110 disabled:opacity-50 transition"
                >
                  Ja, avboka
                </button>
                <button
                  onClick={() => setCancelArmed(false)}
                  disabled={busy}
                  className="h-11 flex-1 rounded-xl border border-[var(--w-line)] text-sm font-semibold text-[var(--w-muted)] hover:border-[var(--w-muted)] transition"
                >
                  Ångra
                </button>
              </div>
            ) : (
              <button
                onClick={() => setCancelArmed(true)}
                className="mt-3 h-11 rounded-xl border border-[var(--w-line)] px-4 text-sm font-semibold text-[var(--w-ink)] hover:border-[var(--w-muted)] transition"
              >
                Avboka — kostnadsfritt
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
