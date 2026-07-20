"use client";

import { useState } from "react";
import {
  cancelInfoText,
  cardDeadline,
  clockTime,
  formatKr,
  type Booking,
  type PolicyConfig,
} from "./booking-types";

// Statuspanelerna i bokningsdetaljen (POC:ns gula/röda/grå paneler):
// - PendingCardPanel: "Väntar på kortbekräftelse" (§3.3) — grace-tokens (gul)
// - ChargedPanel: "No-show-avgift debiterad" (§3.4) — late-tokens (röd)
// - CancelledPanel: "Avbokad" + återaktivering (§3.5) — done-tokens (grå)

export function PendingCardPanel({
  booking,
  policy,
  slug,
}: {
  booking: Booking;
  policy: PolicyConfig;
  slug: string;
}) {
  const [resent, setResent] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const deadline = cardDeadline(
    booking.startsAt,
    policy.cancellationWindowHours,
  );

  async function resend() {
    setSending(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/restaurants/${slug}/bookings/${booking.id}/kortlank`,
        { method: "POST" },
      );
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Kunde inte skicka länken.");
        return;
      }
      setResent(true);
    } catch {
      setError("Något gick fel — prova igen.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="mt-5 rounded-xl border border-status-grace-border bg-status-grace-bg p-4">
      <p className="text-sm font-semibold text-status-grace-fg">
        Väntar på kortbekräftelse
      </p>
      <p className="mt-1 text-xs leading-relaxed text-[var(--w-muted)]">
        En länk har mejlats till gästen — där anger hen kort, och kan även
        ändra eller avboka själv. Bokningen bekräftas automatiskt när kortet
        angetts.
      </p>
      <p className="mt-2 text-xs font-semibold text-status-grace-fg">
        Utan kortbekräftelse avbokas bokningen automatiskt kl{" "}
        {clockTime(deadline)} ({policy.cancellationWindowHours} tim före
        ankomst).
      </p>
      {booking.guestEmail ? (
        <button
          onClick={() => void resend()}
          disabled={sending || resent}
          className="mt-3 min-h-11 rounded-lg border border-status-grace-border px-3 text-xs font-semibold text-status-grace-fg hover:brightness-110 disabled:opacity-60 transition"
        >
          {resent ? "Länken skickades igen" : "Skicka kortlänken igen"}
        </button>
      ) : (
        <p className="mt-2 text-xs text-[var(--w-muted)]">
          Ingen e-post på bokningen — kortlänken kan inte mejlas.
        </p>
      )}
      {error && <p className="mt-2 text-xs text-yellow-400">{error}</p>}
    </div>
  );
}

export function ChargedPanel({ booking }: { booking: Booking }) {
  if (booking.charged === null) return null;
  return (
    <div className="mt-5 rounded-xl border border-status-late-border bg-status-late-bg p-4">
      <p className="text-sm font-semibold text-status-late-fg">
        No-show-avgift debiterad
      </p>
      <p className="mt-1 text-xs leading-relaxed text-[var(--w-muted)]">
        {formatKr(booking.charged)} har debiterats kort ••••{" "}
        {booking.cardLast4 ?? "————"}.
      </p>
    </div>
  );
}

export function CancelledPanel({
  booking,
  policy,
  onReactivate,
  busy,
}: {
  booking: Booking;
  policy: PolicyConfig;
  onReactivate: () => void;
  busy: boolean;
}) {
  return (
    <div className="mt-5 rounded-xl border border-status-done-border bg-status-done-bg p-4">
      <p className="text-sm font-semibold text-status-done-fg">Avbokad</p>
      <p className="mt-1 text-xs leading-relaxed text-[var(--w-muted)]">
        {cancelInfoText(booking.cancelInfo, policy.cancellationWindowHours)}
      </p>
      <button
        onClick={onReactivate}
        disabled={busy}
        className="mt-3 min-h-11 rounded-lg border border-[var(--w-line)] px-3 text-xs font-semibold text-[var(--w-ink)] hover:border-[var(--w-muted)] disabled:opacity-60 transition"
      >
        Återaktivera bokningen
      </button>
    </div>
  );
}
