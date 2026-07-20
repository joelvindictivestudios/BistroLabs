"use client";

import { useEffect, useState } from "react";
import { Avatar } from "@/app/components/avatar";
import type { CustomerRow } from "./customers-client";

// Gästprofilen (§3.12) — innehållet i höger-curtainen (POC:ns gästpanel):
// avatar + kontakt, stat-tiles (besök / no-shows / bokningar / senast),
// märkningar (allergi/stamgäst/barnfamilj) och händelsehistorik ur
// bokningarna. No-show-räknaren beräknas vid läsning, aldrig denormaliserad.

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
  onTagsChange,
}: {
  slug: string;
  guest: CustomerRow;
  onEdit: () => void;
  /** Lyfter märkningsändringar till listan — tabellens chips ska följa med direkt. */
  onTagsChange?: (tags: string[]) => void;
}) {
  const [tags, setTags] = useState<string[]>(guest.tags ?? []);
  const [noShowCount, setNoShowCount] = useState(guest.noShowCount ?? 0);
  const [lastVisit, setLastVisit] = useState(guest.lastVisit);
  const [history, setHistory] = useState<HistoryRow[] | null>(null);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Egna märkningar utöver de tre fasta — fritext, sparas i samma tags-array
  const [addingTag, setAddingTag] = useState(false);
  const [newTag, setNewTag] = useState("");

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

  async function saveTags(next: string[]) {
    setTags(next);
    // Optimistiskt även i tabellen — panelen och raden ska aldrig visa olika
    onTagsChange?.(next);
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

  function toggleTag(key: string) {
    void saveTags(
      tags.includes(key) ? tags.filter((t) => t !== key) : [...tags, key],
    );
  }

  function addCustomTag() {
    const value = newTag.trim();
    if (!value) return;
    if (tags.some((t) => t.toLowerCase() === value.toLowerCase())) {
      setNewTag("");
      setAddingTag(false);
      return;
    }
    if (value.length > 30) {
      setError("Max 30 tecken per märkning.");
      return;
    }
    if (tags.length >= 10) {
      setError("Max 10 märkningar per gäst.");
      return;
    }
    setNewTag("");
    setAddingTag(false);
    void saveTags([...tags, value]);
  }

  const dateLabel = (iso: string) =>
    new Date(iso).toLocaleDateString("sv-SE", {
      day: "numeric",
      month: "short",
    });

  const name = guest.name ?? guest.email ?? guest.phone ?? "Gäst";

  return (
    <div>
      {/* Identitet — POC:ns panelhuvud */}
      <div className="flex items-center gap-3.5">
        <Avatar name={name} size={48} />
        <div className="min-w-0">
          <p className="truncate text-lg font-semibold leading-tight [font-family:var(--font-display),sans-serif]">
            {name}
          </p>
          <p className="truncate text-[13px] text-[var(--w-muted)]">
            {guest.phone ?? guest.email ?? "—"}
          </p>
        </div>
        {saved && !error && (
          <span className="ml-auto shrink-0 text-xs text-emerald-400">
            Sparat ✓
          </span>
        )}
      </div>

      {/* Stat-tiles 2×2 */}
      <div className="mt-5 grid grid-cols-2 gap-2.5">
        <div className="rounded-xl bg-[var(--w-bg)] px-3.5 py-3">
          <p className="text-xs text-[var(--w-muted)]">Besök</p>
          <p className="mt-0.5 text-lg font-bold">{guest.visitCount}</p>
        </div>
        <div className="rounded-xl bg-[var(--w-bg)] px-3.5 py-3">
          <p className="text-xs text-[var(--w-muted)]">No-shows</p>
          <p
            className={`mt-0.5 text-lg font-bold ${
              noShowCount > 0 ? "text-status-late-fg" : ""
            }`}
          >
            {noShowCount}
          </p>
        </div>
        <div className="rounded-xl bg-[var(--w-bg)] px-3.5 py-3">
          <p className="text-xs text-[var(--w-muted)]">Bokningar</p>
          <p className="mt-0.5 text-lg font-bold">{guest.bookingCount}</p>
        </div>
        <div className="rounded-xl bg-[var(--w-bg)] px-3.5 py-3">
          <p className="text-xs text-[var(--w-muted)]">Senast</p>
          <p className="mt-0.5 text-lg font-bold">
            {lastVisit ? dateLabel(lastVisit) : "—"}
          </p>
        </div>
      </div>

      {/* Märkningar: tre fasta + egna fritextmärkningar i samma tags-array */}
      <div className="mt-5">
        <p className="text-xs text-[var(--w-muted)]">Märkning</p>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          {TAGS.map((t) => (
            <button
              key={t.key}
              aria-pressed={tags.includes(t.key)}
              onClick={() => toggleTag(t.key)}
              className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
                tags.includes(t.key)
                  ? "border-[var(--w-accent)] bg-[var(--w-accent)]/15 text-[var(--w-ink)]"
                  : "border-[var(--w-line)] text-[var(--w-muted)] hover:border-[var(--w-muted)]"
              }`}
            >
              {t.label}
            </button>
          ))}
          {tags
            .filter((t) => !TAGS.some((s) => s.key === t))
            .map((t) => (
              <button
                key={t}
                onClick={() => void saveTags(tags.filter((x) => x !== t))}
                title="Ta bort märkningen"
                className="group flex items-center gap-1.5 rounded-full border border-[var(--w-line)] bg-[var(--w-bg)] px-3 py-1.5 text-xs font-semibold text-[var(--w-ink)] transition-colors hover:border-status-late-border hover:text-status-late-fg"
              >
                {t}
                <span aria-hidden className="text-[var(--w-muted)] group-hover:text-status-late-fg">
                  ✕
                </span>
              </button>
            ))}
          {addingTag ? (
            <span className="flex items-center gap-1.5">
              <input
                autoFocus
                value={newTag}
                onChange={(e) => setNewTag(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") addCustomTag();
                  if (e.key === "Escape") {
                    setAddingTag(false);
                    setNewTag("");
                  }
                }}
                maxLength={30}
                placeholder="Egen märkning…"
                className="w-32 rounded-full border border-[var(--w-accent)] bg-transparent px-3 py-1.5 text-xs focus:outline-none"
              />
              <button
                onClick={addCustomTag}
                disabled={!newTag.trim()}
                className="rounded-full bg-[var(--w-accent)] px-3 py-1.5 text-xs font-semibold text-accent-on hover:brightness-110 disabled:opacity-50 transition"
              >
                Lägg till
              </button>
            </span>
          ) : (
            <button
              onClick={() => setAddingTag(true)}
              className="rounded-full border border-dashed border-[var(--w-line)] px-3 py-1.5 text-xs font-semibold text-[var(--w-muted)] transition-colors hover:border-[var(--w-accent)] hover:text-[var(--w-accent)]"
            >
              + Ny märkning
            </button>
          )}
        </div>
      </div>

      {/* Historik */}
      <div className="mt-5">
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
          <div className="mt-1 divide-y divide-[var(--w-line)]/60">
            {history.map((h) => (
              <div
                key={h.id}
                className="flex items-center justify-between gap-3 py-2 text-[13.5px]"
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
        className="mt-6 h-10 w-full rounded-xl border border-[var(--w-line)] text-sm text-[var(--w-muted)] hover:border-[var(--w-accent)] hover:text-[var(--w-ink)] transition"
      >
        Redigera uppgifter
      </button>
    </div>
  );
}
