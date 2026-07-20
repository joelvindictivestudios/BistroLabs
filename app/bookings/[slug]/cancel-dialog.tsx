"use client";

import { useEffect, useState } from "react";
import {
  cardDeadline,
  clockTime,
  type Booking,
  type PolicyConfig,
  type WaitlistEntry,
} from "./booking-types";

// Avbokningsdialogen (§3.5): policyrad + väntelistematch. Ersätter de gamla
// inline-tvåstegsremsorna — matchen och "gästen meddelas" ska synas vid VARJE
// avbokning, oavsett var den startas ifrån.

export function CancelDialog({
  slug,
  booking,
  policy,
  busy,
  onCancel,
  onCancelAndOffer,
  onClose,
}: {
  slug: string;
  booking: Booking;
  policy: PolicyConfig;
  busy: boolean;
  onCancel: () => void;
  onCancelAndOffer: (entryId: string, time: string) => void;
  onClose: () => void;
}) {
  const [match, setMatch] = useState<WaitlistEntry | null>(null);
  // Frusen vid öppning — policyraden ska inte flippa mitt i dialogen
  const [openedAt] = useState(() => Date.now());

  // Väntelistematchen hämtas när dialogen öppnas (§3.8) — endpointen kommer
  // med väntelistan (etapp 8); 404 innan dess är ofarligt.
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const res = await fetch(
          `/api/restaurants/${slug}/bookings/${booking.id}/waitlist-match`,
        );
        if (!res.ok) return;
        const data = await res.json();
        if (alive) setMatch(data.match ?? null);
      } catch {
        /* matchen är en bonus — dialogen fungerar utan */
      }
    })();
    return () => {
      alive = false;
    };
  }, [slug, booking.id]);

  const beforeDeadline =
    openedAt <
    cardDeadline(booking.startsAt, policy.cancellationWindowHours).getTime();
  const startClock = clockTime(new Date(booking.startsAt));

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-6"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-label="Avboka bokningen?"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-2xl border border-[var(--w-line)] bg-[var(--w-panel)] p-6 shadow-2xl"
      >
        <h3 className="text-xl font-semibold tracking-tight [font-family:var(--font-display),sans-serif]">
          Avboka bokningen?
        </h3>
        <p className="mt-1 text-sm text-[var(--w-muted)]">
          {booking.guestName} · {booking.partySize} pers · kl {startClock}
        </p>

        <div className="mt-5 rounded-xl border border-[var(--w-line)] bg-[var(--w-bg)] p-4 text-sm leading-relaxed text-[var(--w-muted)]">
          {beforeDeadline
            ? `Kostnadsfri avbokning — mer än ${policy.cancellationWindowHours} timmar till ankomst. `
            : `Mindre än ${policy.cancellationWindowHours} timmar till ankomst. `}
          Gästen meddelas via SMS och e-post, och bordet frigörs direkt.
        </div>

        {match && (
          <div className="mt-3 rounded-xl border border-status-grace-border bg-status-grace-bg p-4">
            <p className="text-sm font-semibold text-status-grace-fg">
              Väntelistan matchar
            </p>
            <p className="mt-1 text-xs leading-relaxed text-[var(--w-muted)]">
              {match.name} ({match.partySize} pers) önskar {match.wishedFrom}–
              {match.wishedTo} ikväll.
            </p>
          </div>
        )}

        <div className="mt-5 space-y-2">
          {match && (
            <button
              onClick={() => onCancelAndOffer(match.id, startClock)}
              disabled={busy}
              className="min-h-11 w-full rounded-xl bg-[var(--w-accent)] text-sm font-semibold text-accent-on hover:brightness-110 disabled:opacity-60 transition"
            >
              Avboka och erbjud tiden till {match.name.split(/\s+/)[0]}
            </button>
          )}
          <button
            onClick={onCancel}
            disabled={busy}
            className="min-h-11 w-full rounded-xl bg-[#b5503f] text-sm font-semibold text-white hover:brightness-110 disabled:opacity-60 transition"
          >
            Avboka bokningen
          </button>
          <button
            onClick={onClose}
            disabled={busy}
            className="min-h-11 w-full rounded-xl border border-[var(--w-line)] text-sm text-[var(--w-muted)] hover:text-[var(--w-ink)] transition"
          >
            Behåll bokningen
          </button>
        </div>
      </div>
    </div>
  );
}
