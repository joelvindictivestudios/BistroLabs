"use client";

import { useState } from "react";

// Inställningar: grunduppgifter + bokningsregler för gästkanalerna.

type Props = {
  slug: string;
  initialName: string;
  initialAddress: string;
  initialSameDayCutoff: string | null;
  initialEscalationPartySize: number;
};

export function SettingsClient({
  slug,
  initialName,
  initialAddress,
  initialSameDayCutoff,
  initialEscalationPartySize,
}: Props) {
  const [name, setName] = useState(initialName);
  const [address, setAddress] = useState(initialAddress);
  const [cutoffEnabled, setCutoffEnabled] = useState(
    initialSameDayCutoff !== null,
  );
  const [cutoff, setCutoff] = useState(initialSameDayCutoff ?? "14:00");
  const [maxParty, setMaxParty] = useState(initialEscalationPartySize);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setError(null);
    setSavedAt(null);
    try {
      const res = await fetch(`/api/restaurants/${slug}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          address,
          sameDayCutoff: cutoffEnabled ? cutoff : null,
          escalationPartySize: maxParty,
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error ?? "Kunde inte spara.");
        return;
      }
      setSavedAt(Date.now());
    } catch {
      setError("Något gick fel — prova igen.");
    } finally {
      setSaving(false);
    }
  }

  const inputClass =
    "w-full bg-transparent border-b border-[var(--w-line)] py-2 text-sm placeholder:text-[var(--w-muted)]/60 focus:border-[var(--w-accent)] focus:outline-none";
  const labelClass =
    "text-[11px] uppercase tracking-[0.22em] text-[var(--w-muted)]";

  return (
    <div className="mx-auto max-w-2xl space-y-12">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight [font-family:var(--font-display),sans-serif]">
            Inställningar
          </h1>
          <p className="mt-1 text-sm text-[var(--w-muted)]">
            Grunduppgifter och bokningsregler för gästkanalerna.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {error && <span className="text-xs text-yellow-400">{error}</span>}
          {savedAt && !error && (
            <span className="text-xs text-emerald-400">Sparat ✓</span>
          )}
          <button
            onClick={save}
            disabled={saving}
            className="h-10 rounded-xl bg-[var(--w-accent)] px-5 text-sm font-semibold text-[#141210] shadow-lg shadow-black/25 hover:brightness-110 disabled:opacity-60 transition"
          >
            {saving ? "Sparar…" : "Spara"}
          </button>
        </div>
      </div>

      <section>
        <h2 className={labelClass}>Grunduppgifter</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Restaurangens namn"
            className={inputClass}
          />
          <input
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="Adress"
            className={inputClass}
          />
        </div>
      </section>

      <section>
        <h2 className={labelClass}>Bokningsregler</h2>
        <div className="mt-4 space-y-5">
          <div className="flex items-center gap-3 text-sm">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={cutoffEnabled}
                onChange={(e) => setCutoffEnabled(e.target.checked)}
                className="accent-[var(--w-accent)]"
              />
              Stäng same-day-bokningar efter
            </label>
            <input
              type="time"
              value={cutoff}
              onChange={(e) => setCutoff(e.target.value)}
              disabled={!cutoffEnabled}
              className="rounded-lg border border-[var(--w-line)] bg-[var(--w-panel)] px-2 py-1 font-mono text-xs disabled:opacity-40"
            />
          </div>
          <p className="text-xs text-[var(--w-muted)]">
            Efter klockslaget kan gäster inte längre boka för samma dag via
            widget eller AI. Personalen kan alltid lägga drop-ins.
          </p>
          <label className="block text-sm">
            <span className="text-xs text-[var(--w-muted)]">
              Max sällskapsstorlek online (större hänvisas till mejl)
            </span>
            <input
              type="number"
              min={1}
              max={50}
              value={maxParty}
              onChange={(e) =>
                setMaxParty(
                  Math.min(50, Math.max(1, Number(e.target.value) || 1)),
                )
              }
              className={`${inputClass} w-24 font-mono`}
            />
          </label>
        </div>
      </section>
    </div>
  );
}
