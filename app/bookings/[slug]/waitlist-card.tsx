"use client";

import { useState } from "react";
import { Avatar } from "@/app/components/avatar";
import type { WaitlistEntry } from "./booking-types";

// Väntelistekortet överst i bokningslistan (§3.8): kön för vald dag,
// "Erbjud bord" → OFFERED + SMS (först till kvarn). Tom kö → inget kort.

export function WaitlistCard({
  entries,
  onOffer,
  onRemove,
}: {
  entries: WaitlistEntry[];
  onOffer: (id: string) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
}) {
  const [busyId, setBusyId] = useState<string | null>(null);
  if (entries.length === 0) return null;

  return (
    <div className="mb-4 rounded-xl border border-[var(--w-line)] bg-[var(--w-panel)] p-3">
      <div className="flex items-center justify-between">
        <span className="text-[11px] uppercase tracking-[0.22em] text-[var(--w-muted)]">
          Väntelista
        </span>
        <span className="text-xs text-[var(--w-muted)]">
          {entries.length} i kö
        </span>
      </div>
      <div className="mt-2 space-y-2">
        {entries.map((w) => (
          <div key={w.id} className="flex items-center gap-3">
            <Avatar name={w.name} size={34} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{w.name}</p>
              <p className="text-xs text-[var(--w-muted)]">
                {w.partySize} pers · önskar {w.wishedFrom}–{w.wishedTo}
              </p>
            </div>
            {w.status === "OFFERED" ? (
              <span className="rounded-full border border-status-seated-border bg-status-seated-bg px-2.5 py-1 text-[10px] font-medium text-status-seated-fg">
                Erbjuden{w.offeredTime ? ` ${w.offeredTime}` : ""} · SMS skickat
              </span>
            ) : (
              <button
                onClick={() => {
                  setBusyId(w.id);
                  void onOffer(w.id).finally(() => setBusyId(null));
                }}
                disabled={busyId === w.id}
                className="min-h-11 rounded-lg border border-[var(--w-accent)]/50 px-3 text-xs font-semibold text-[var(--w-accent)] hover:bg-[var(--w-accent)]/10 disabled:opacity-60 transition"
              >
                Erbjud bord
              </button>
            )}
            <button
              onClick={() => {
                setBusyId(w.id);
                void onRemove(w.id).finally(() => setBusyId(null));
              }}
              disabled={busyId === w.id}
              aria-label={`Ta bort ${w.name} från väntelistan`}
              className="rounded-lg p-2 text-[var(--w-muted)] hover:text-[var(--w-ink)] disabled:opacity-60 transition"
            >
              <svg
                width="14"
                height="14"
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
        ))}
      </div>
    </div>
  );
}
