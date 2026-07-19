"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

// Inställningar: utseende (tema), grunduppgifter + bokningsregler för
// gästkanalerna. Temaklick förhandsvisas direkt (data-theme sätts på
// layoutens rot i DOM) men gäller först efter Spara — lämnar man sidan
// osparad återställs det sparade temat.

type Theme = "classic" | "warm" | "light";

const THEMES: {
  key: Theme;
  label: string;
  description: string;
  swatch: { bg: string; panel: string; accent: string };
}[] = [
  {
    key: "classic",
    label: "Mörk",
    description: "Ursprungliga mörkgröna looken med mässing",
    swatch: { bg: "#101312", panel: "#161b19", accent: "#c89b5a" },
  },
  {
    key: "warm",
    label: "Varm",
    description: "Nya värdshuskänslan — varm mörk med terrakotta",
    swatch: { bg: "#1b1713", panel: "#262019", accent: "#c0673f" },
  },
  {
    key: "light",
    label: "Ljus",
    description: "Ljus och varm — för dagsljusa miljöer",
    swatch: { bg: "#f7f3ee", panel: "#ffffff", accent: "#c0673f" },
  },
];

type Props = {
  slug: string;
  initialName: string;
  initialAddress: string;
  initialSameDayCutoff: string | null;
  initialEscalationPartySize: number;
  initialTheme: Theme;
};

export function SettingsClient({
  slug,
  initialName,
  initialAddress,
  initialSameDayCutoff,
  initialEscalationPartySize,
  initialTheme,
}: Props) {
  const router = useRouter();
  const [name, setName] = useState(initialName);
  const [address, setAddress] = useState(initialAddress);
  const [cutoffEnabled, setCutoffEnabled] = useState(
    initialSameDayCutoff !== null,
  );
  const [cutoff, setCutoff] = useState(initialSameDayCutoff ?? "14:00");
  const [maxParty, setMaxParty] = useState(initialEscalationPartySize);
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const [savedTheme, setSavedTheme] = useState<Theme>(initialTheme);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Layoutens rot bär data-theme (serverrenderat). Förhandsvisningen skriver
  // attributet direkt; senast SPARADE temat återställs vid unmount.
  const savedThemeRef = useRef(initialTheme);
  useEffect(() => {
    savedThemeRef.current = savedTheme;
  }, [savedTheme]);

  const themeRoot = () =>
    document.querySelector<HTMLElement>("[data-theme]");

  function previewTheme(t: Theme) {
    setTheme(t);
    themeRoot()?.setAttribute("data-theme", t);
  }

  useEffect(() => {
    return () => {
      themeRoot()?.setAttribute("data-theme", savedThemeRef.current);
    };
  }, []);

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
          theme,
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error ?? "Kunde inte spara.");
        return;
      }
      setSavedAt(Date.now());
      if (theme !== savedTheme) {
        setSavedTheme(theme);
        router.refresh();
      }
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
        <h2 className={labelClass}>Utseende</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          {THEMES.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => previewTheme(t.key)}
              aria-pressed={theme === t.key}
              className={`rounded-2xl border p-4 text-left transition-colors ${
                theme === t.key
                  ? "border-[var(--w-accent)] bg-[var(--w-accent)]/10"
                  : "border-[var(--w-line)] hover:border-[var(--w-muted)]"
              }`}
            >
              <span
                className="flex h-10 items-center gap-1.5 rounded-lg border border-black/20 px-2"
                style={{ background: t.swatch.bg }}
              >
                <span
                  className="h-6 w-8 rounded"
                  style={{ background: t.swatch.panel }}
                />
                <span
                  className="h-6 w-3 rounded"
                  style={{ background: t.swatch.accent }}
                />
              </span>
              <span className="mt-2.5 block text-sm font-semibold">
                {t.label}
              </span>
              <span className="mt-0.5 block text-xs text-[var(--w-muted)]">
                {t.description}
              </span>
            </button>
          ))}
        </div>
        <p className="mt-2 text-xs text-[var(--w-muted)]">
          Gäller personalvyerna. Gästwidgetens tema väljs i widget-editorn.
          {theme !== savedTheme && (
            <span className="ml-1 font-semibold text-[var(--w-accent)]">
              Förhandsvisning — spara för att behålla.
            </span>
          )}
        </p>
      </section>

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
