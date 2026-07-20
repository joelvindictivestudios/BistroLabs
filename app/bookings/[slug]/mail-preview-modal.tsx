"use client";

import { useEffect, useState } from "react";
import type { Booking } from "./booking-types";

// "Visa utskick" (§3.7): förhandsvisar de tre mallarna renderade med
// bokningens riktiga data — hämtas från utskick-endpointen som använder
// exakt samma mallbuilders som de skarpa utskicken.

type Template = { key: string; label: string; subject: string; text: string };
type Payload = { to: string; from: string; templates: Template[] };

export function MailPreviewModal({
  slug,
  booking,
  onClose,
}: {
  slug: string;
  booking: Booking;
  onClose: () => void;
}) {
  const [payload, setPayload] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Preliminära öppnar på Kortlänk (POC-beteendet), övriga på Bekräftelse
  const [tab, setTab] = useState(
    booking.status === "PENDING" ? "kortlank" : "bekraftelse",
  );

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const res = await fetch(
          `/api/restaurants/${slug}/bookings/${booking.id}/utskick`,
        );
        const data = await res.json();
        if (!alive) return;
        if (!res.ok) {
          setError(data.error ?? "Kunde inte hämta utskicken.");
          return;
        }
        setPayload(data);
      } catch {
        if (alive) setError("Kunde inte hämta utskicken.");
      }
    })();
    return () => {
      alive = false;
    };
  }, [slug, booking.id]);

  const active = payload?.templates.find((t) => t.key === tab);

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-6"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-label="Utskick till gästen"
        onClick={(e) => e.stopPropagation()}
        className="max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-2xl border border-[var(--w-line)] bg-[var(--w-panel)] p-6 shadow-2xl"
      >
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold tracking-tight [font-family:var(--font-display),sans-serif]">
            Utskick till gästen
          </h3>
          <button
            onClick={onClose}
            aria-label="Stäng"
            className="rounded-lg p-1 text-[var(--w-muted)] hover:text-[var(--w-ink)] transition"
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            >
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="mt-3 flex gap-1.5">
          {(payload?.templates ?? []).map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              aria-pressed={tab === t.key}
              className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
                tab === t.key
                  ? "border-[var(--w-accent)] bg-[var(--w-accent)]/15 text-[var(--w-ink)]"
                  : "border-[var(--w-line)] text-[var(--w-muted)] hover:border-[var(--w-muted)]"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {error && <p className="mt-4 text-xs text-yellow-400">{error}</p>}
        {!payload && !error && (
          <p className="mt-4 text-xs text-[var(--w-muted)]">Hämtar utskick…</p>
        )}

        {active && payload && (
          <div className="mt-4 overflow-hidden rounded-xl border border-[var(--w-line)]">
            <div className="border-b border-[var(--w-line)] bg-[var(--w-bg)] px-4 py-2.5">
              <p className="text-[10px] text-[var(--w-muted)]">
                Från: {payload.from}
              </p>
              <p className="text-[10px] text-[var(--w-muted)]">
                Till: {payload.to}
              </p>
            </div>
            <div className="p-4">
              <p className="text-sm font-semibold">{active.subject}</p>
              <p className="mt-3 whitespace-pre-line text-xs leading-relaxed text-[var(--w-muted)]">
                {active.text}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
