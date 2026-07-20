"use client";

import { useEffect, useState } from "react";
import type { CustomerRow } from "./customers-client";

// Gästprofilen (§3.12): stat-tiles (besök / no-shows / senaste besök),
// märkningar (allergi/stamgäst/barnfamilj) och händelsehistorik ur
// bokningarna — no-show-räknaren beräknas vid läsning, aldrig denormaliserad.

const TAGS = [
  { key: "allergi", label: "Allergi" },
  { key: "stamgäst", label: "Stamgäst" },
  { key: "barnfamilj", label: "Barnfamilj" },
] as const;

type HistoryRow = {
  id: string;
  at: string;
  partySize: number;
  status: string;
  charged: number | null;
  cancelledBy: string | null;
};

function historyLabel(h: HistoryRow): string {
  const pers = `${h.partySize} pers`;
  switch (h.status) {
    case "COMPLETED":
    case "SEATED":
      return `Besök · ${pers}`;
    case "NO_SHOW":
      return h.charged !== null
        ? `No-show — ${h.charged.toLocaleString("sv-SE")} kr debiterad`
        : "No-show — inget kort, ej debiterad";
    case "CANCELLED":
      return h.cancelledBy === "auto"
        ? "Avbokning — auto (ej bekräftad i tid)"
        : h.cancelledBy === "gäst"
          ? "Avbokning — i tid, kostnadsfri (via länken)"
          : "Avbokning — av personal";
    case "PENDING":
      return `Preliminär bokning · ${pers}`;
    default:
      return `Bokning · ${pers}`;
  }
}

export function CustomerProfile({
  slug,
  guest,
  onEdit,
  onClose,
}: {
  slug: string;
  guest: CustomerRow;
  onEdit: () => void;
  onClose: () => void;
}) {
  const [tags, setTags] = useState<string[]>(guest.tags ?? []);
  const [noShowCount, setNoShowCount] = useState(guest.noShowCount ?? 0);
  const [lastVisit, setLastVisit] = useState(guest.lastVisit);
  const [history, setHistory] = useState<HistoryRow[] | null>(null);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const res = await fetch(`/api/restaurants/${slug}/guests/${guest.id}`);
        const data = await res.json();
        if (!alive) return;
        if (!res.ok) {
          setError(data.error ?? "Kunde inte hämta historiken.");
          return;
        }
        setTags(data.tags ?? []);
        setNoShowCount(data.noShowCount ?? 0);
        setLastVisit(data.lastVisit ?? null);
        setHistory(data.history ?? []);
      } catch {
        if (alive) setError("Kunde inte hämta historiken.");
      }
    })();
    return () => {
      alive = false;
    };
  }, [slug, guest.id]);

  async function toggleTag(key: string) {
    const next = tags.includes(key)
      ? tags.filter((t) => t !== key)
      : [...tags, key];
    setTags(next);
    setSaved(false);
    setError(null);
    try {
      const res = await fetch(`/api/restaurants/${slug}/guests/${guest.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tags: next }),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error ?? "Kunde inte spara märkningen.");
        return;
      }
      setSaved(true);
    } catch {
      setError("Kunde inte spara märkningen.");
    }
  }

  const dateLabel = (iso: string) =>
    new Date(iso).toLocaleDateString("sv-SE", {
      day: "numeric",
      month: "short",
    });

  return (
    <div className="rounded-2xl border border-[var(--w-line)] bg-[var(--w-panel)] p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-[0.22em] text-[var(--w-muted)]">
            Gästprofil
          </p>
          <h2 className="mt-1 text-lg font-semibold">
            {guest.name ?? guest.email ?? guest.phone ?? "Gäst"}
          </h2>
        </div>
        <div className="flex items-center gap-2">
          {saved && !error && (
            <span className="text-xs text-emerald-400">Sparat ✓</span>
          )}
          <button
            onClick={onClose}
            aria-label="Stäng profilen"
            className="rounded-lg p-1.5 text-[var(--w-muted)] hover:text-[var(--w-ink)] transition"
          >
            ✕
          </button>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2">
        <div className="rounded-xl bg-[var(--w-bg)] p-3">
          <p className="text-xs text-[var(--w-muted)]">Besök</p>
          <p className="mt-0.5 text-lg font-bold">{guest.visitCount}</p>
        </div>
        <div className="rounded-xl bg-[var(--w-bg)] p-3">
          <p className="text-xs text-[var(--w-muted)]">No-shows</p>
          <p
            className={`mt-0.5 text-lg font-bold ${
              noShowCount > 0 ? "text-status-late-fg" : ""
            }`}
          >
            {noShowCount}
          </p>
        </div>
        <div className="rounded-xl bg-[var(--w-bg)] p-3">
          <p className="text-xs text-[var(--w-muted)]">Senaste besök</p>
          <p className="mt-0.5 text-lg font-bold">
            {lastVisit ? dateLabel(lastVisit) : "—"}
          </p>
        </div>
      </div>

      <div className="mt-4">
        <p className="text-xs text-[var(--w-muted)]">Märkning</p>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {TAGS.map((t) => (
            <button
              key={t.key}
              aria-pressed={tags.includes(t.key)}
              onClick={() => void toggleTag(t.key)}
              className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
                tags.includes(t.key)
                  ? "border-[var(--w-accent)] bg-[var(--w-accent)]/15 text-[var(--w-ink)]"
                  : "border-[var(--w-line)] text-[var(--w-muted)] hover:border-[var(--w-muted)]"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-4">
        <p className="text-xs text-[var(--w-muted)]">Historik</p>
        {history === null && !error && (
          <p className="mt-1.5 text-xs text-[var(--w-muted)]">Hämtar…</p>
        )}
        {error && <p className="mt-1.5 text-xs text-yellow-400">{error}</p>}
        {history && history.length === 0 && (
          <p className="mt-1.5 text-xs text-[var(--w-muted)]">
            Inga bokningar ännu.
          </p>
        )}
        {history && history.length > 0 && (
          <div className="mt-1.5 divide-y divide-[var(--w-line)]/60">
            {history.map((h) => (
              <div
                key={h.id}
                className="flex items-center justify-between gap-3 py-2 text-sm"
              >
                <span
                  className={
                    h.status === "NO_SHOW" ? "text-status-late-fg" : ""
                  }
                >
                  {historyLabel(h)}
                </span>
                <span className="shrink-0 text-xs text-[var(--w-muted)]">
                  {dateLabel(h.at)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <button
        onClick={onEdit}
        className="mt-4 h-10 rounded-xl border border-[var(--w-line)] px-4 text-sm text-[var(--w-muted)] hover:border-[var(--w-accent)] hover:text-[var(--w-ink)] transition"
      >
        Redigera uppgifter
      </button>
    </div>
  );
}
