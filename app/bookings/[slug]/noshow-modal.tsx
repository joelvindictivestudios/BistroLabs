"use client";

import { formatKr, clockTime, type Booking, type PolicyConfig } from "./booking-types";

// No-show-dialogen (§3.4). Med kort: specifikation + primär "Debitera X kr
// och markera" + sekundär utan avgift. Utan kort (även när kortgarantin är
// avslagen per §2b p.4): endast markera utan avgift.

export function NoShowModal({
  booking,
  policy,
  busy,
  onCharge,
  onNoCharge,
  onClose,
}: {
  booking: Booking;
  policy: PolicyConfig;
  busy: boolean;
  onCharge: () => void;
  onNoCharge: () => void;
  onClose: () => void;
}) {
  const hasCard = !!booking.cardLast4;
  const amount = policy.noShowFeePerGuest * booking.partySize;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-6"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-label="Markera som no-show"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-2xl border border-[var(--w-line)] bg-[var(--w-panel)] p-6 shadow-2xl"
      >
        <h3 className="text-xl font-semibold tracking-tight [font-family:var(--font-display),sans-serif]">
          Markera som no-show
        </h3>
        <p className="mt-1 text-sm text-[var(--w-muted)]">
          {booking.guestName} · {booking.partySize} pers · kl{" "}
          {clockTime(new Date(booking.startsAt))}
        </p>

        {hasCard ? (
          <div className="mt-5 rounded-xl border border-[var(--w-line)] px-4">
            <div className="flex justify-between py-2.5 text-sm">
              <span className="text-[var(--w-muted)]">Kort</span>
              <span className="font-mono font-medium">
                •••• {booking.cardLast4}
              </span>
            </div>
            <div className="flex justify-between border-t border-[var(--w-line)] py-2.5 text-sm">
              <span className="text-[var(--w-muted)]">Avgift</span>
              <span className="font-medium">
                {policy.noShowFeePerGuest} kr × {booking.partySize}{" "}
                {booking.partySize === 1 ? "gäst" : "gäster"}
              </span>
            </div>
            <div className="flex justify-between border-t border-[var(--w-line)] py-3 text-sm font-semibold">
              <span>Att debitera</span>
              <span>{formatKr(amount)}</span>
            </div>
          </div>
        ) : (
          <div className="mt-5 rounded-xl border border-dashed border-[var(--w-line)] bg-[var(--w-bg)] p-4 text-sm leading-relaxed text-[var(--w-muted)]">
            Inget kort är registrerat på bokningen — no-show-avgiften kan inte
            debiteras.
          </div>
        )}

        <div className="mt-5 space-y-2">
          {hasCard && (
            <button
              onClick={onCharge}
              disabled={busy}
              className="min-h-11 w-full rounded-xl bg-[#b5503f] text-sm font-semibold text-white hover:brightness-110 disabled:opacity-60 transition"
            >
              Debitera {formatKr(amount)} och markera
            </button>
          )}
          <button
            onClick={onNoCharge}
            disabled={busy}
            className={`min-h-11 w-full rounded-xl text-sm font-semibold transition disabled:opacity-60 ${
              hasCard
                ? "border border-[var(--w-line)] text-[var(--w-ink)] hover:border-[var(--w-muted)]"
                : "bg-[#b5503f] text-white hover:brightness-110"
            }`}
          >
            {hasCard ? "Markera no-show utan avgift" : "Markera som no-show"}
          </button>
          <button
            onClick={onClose}
            disabled={busy}
            className="min-h-11 w-full rounded-xl text-sm text-[var(--w-muted)] hover:text-[var(--w-ink)] transition"
          >
            Avbryt
          </button>
        </div>
      </div>
    </div>
  );
}
