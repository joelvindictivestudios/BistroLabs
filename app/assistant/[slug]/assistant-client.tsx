"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import type { RestaurantConfig } from "@/lib/email-concierge/types";
import type { CoreFactsStatus } from "@/lib/restaurant/core-facts";

// Bokningsassistenten (telefon): röstval, samtalsinställningar och ett eget
// Twilio-nummer. Gated bakom grundinfo i Träna din AI — assistenten ska inte
// gå live innan den vet öppettider, adress och kan något om restaurangen.

type VoiceAgent = RestaurantConfig["voiceAgent"];

// Whitelabel-namn för gpt-realtime-rösterna — värdet som sparas är riktiga id:t
const VOICES = [
  { id: "coral", label: "Alva", description: "Varm och välkomnande" },
  { id: "sage", label: "Saga", description: "Lugn och saklig" },
  { id: "shimmer", label: "Ebba", description: "Mjuk och lätt" },
  { id: "echo", label: "Nils", description: "Klar och tydlig" },
  { id: "ash", label: "Otto", description: "Djup och trygg" },
  { id: "verse", label: "Vera", description: "Energisk och snabb" },
] as const;

type Props = {
  slug: string;
  restaurantName: string;
  initialVoiceAgent: VoiceAgent;
  coreFacts: CoreFactsStatus;
};

export function AssistantClient({
  slug,
  restaurantName,
  initialVoiceAgent,
  coreFacts,
}: Props) {
  const [voiceAgent, setVoiceAgent] = useState<VoiceAgent>(initialVoiceAgent);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const update = <K extends keyof VoiceAgent>(key: K, value: VoiceAgent[K]) =>
    setVoiceAgent((v) => ({ ...v, [key]: value }));

  async function save() {
    setSaving(true);
    setError(null);
    setSavedAt(null);
    try {
      const res = await fetch(`/api/restaurants/${slug}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          voiceAgent: {
            voice: voiceAgent.voice,
            greeting: voiceAgent.greeting,
            maxWaitSeconds: voiceAgent.maxWaitSeconds,
            transferNumber: voiceAgent.transferNumber,
          },
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

  async function generateNumber() {
    setGenerating(true);
    setError(null);
    try {
      const res = await fetch(`/api/restaurants/${slug}/phone-number`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Nummerköpet misslyckades.");
        return;
      }
      update("phoneNumber", data.phoneNumber);
    } catch {
      setError("Något gick fel — prova igen.");
    } finally {
      setGenerating(false);
    }
  }

  const inputClass =
    "w-full bg-transparent border-b border-[var(--w-line)] py-2 text-sm placeholder:text-[var(--w-muted)]/60 focus:border-[var(--w-accent)] focus:outline-none";
  const labelClass =
    "text-[11px] uppercase tracking-[0.22em] text-[var(--w-muted)]";

  return (
    <div
      className="min-h-dvh bg-[var(--w-bg)] text-[var(--w-ink)]"
      style={
        {
          "--w-bg": "#101312",
          "--w-panel": "#161b19",
          "--w-line": "#2a312d",
          "--w-ink": "#ede7dc",
          "--w-muted": "#8b9389",
          "--w-accent": "#c89b5a",
        } as React.CSSProperties
      }
    >
      <header className="flex h-16 items-center gap-4 border-b border-[var(--w-line)] px-6">
        <Link href={`/dashboard/${slug}`} aria-label="Till översikten">
          <Image
            src="/BLWhiteSide.png"
            alt="BistroLabs"
            width={138}
            height={30}
            className="h-7 w-auto"
          />
        </Link>
        <Link
          href={`/dashboard/${slug}`}
          className="text-xs mt-2 text-[var(--w-muted)] hover:text-[var(--w-ink)] transition-colors"
        >
          ‹ Översikt
        </Link>
        <div className="ml-auto flex items-center gap-3">
          {error && <span className="max-w-md text-xs text-yellow-400">{error}</span>}
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
      </header>

      <main className="mx-auto max-w-2xl px-6 py-10 space-y-12">
        <div>
          <p className={labelClass}>Bokningsassistent</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight [font-family:var(--font-display),sans-serif]">
            AI:n som svarar i telefon
          </h1>
          <p className="mt-2 text-sm text-[var(--w-muted)]">
            Gäster ringer, assistenten svarar med {restaurantName}s kunskap och
            bokar bord direkt i systemet.
          </p>
        </div>

        {/* Telefonnummer */}
        <section>
          <h2 className={labelClass}>Telefonnummer</h2>
          {voiceAgent.phoneNumber ? (
            <div className="mt-4 rounded-2xl border border-[var(--w-line)] bg-[var(--w-panel)] p-6">
              <div className="flex items-center gap-3">
                <p className="font-mono text-2xl">{voiceAgent.phoneNumber}</p>
                <button
                  onClick={async () => {
                    await navigator.clipboard.writeText(voiceAgent.phoneNumber);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 2000);
                  }}
                  className="rounded-lg border border-[var(--w-line)] px-3 py-1.5 text-xs text-[var(--w-accent)] hover:border-[var(--w-accent)] transition"
                >
                  {copied ? "Kopierat ✓" : "Kopiera"}
                </button>
              </div>
              <p className="mt-3 text-xs text-[var(--w-muted)]">
                Väntsvar aktivt — numret kopplas till AI-assistenten när
                röstagenten lanseras.
              </p>
            </div>
          ) : (
            <div className="mt-4">
              <div className="group relative inline-block">
                <button
                  onClick={generateNumber}
                  disabled={!coreFacts.complete || generating}
                  className="h-12 rounded-xl bg-[var(--w-accent)] px-6 text-sm font-semibold text-[#141210] shadow-lg shadow-black/25 hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed transition"
                >
                  {generating ? "Genererar…" : "Generera telefonnummer"}
                </button>
                {!coreFacts.complete && (
                  <span
                    role="tooltip"
                    className="pointer-events-none absolute left-0 top-full z-10 mt-2 hidden w-72 rounded-lg border border-[var(--w-line)] bg-[var(--w-panel)] p-3 text-xs text-[var(--w-muted)] group-hover:block"
                  >
                    Fyll i grundinfo under{" "}
                    <span className="text-[var(--w-ink)]">Träna din AI</span>{" "}
                    först — AI:n ska kunna svara på riktiga frågor innan den
                    tar emot samtal.
                  </span>
                )}
              </div>
              {!coreFacts.complete && (
                <ul className="mt-4 space-y-1 text-xs text-[var(--w-muted)]">
                  <li>{coreFacts.hasAddress ? "✓" : "○"} Adress</li>
                  <li>{coreFacts.hasOpeningHours ? "✓" : "○"} Öppettider</li>
                  <li>
                    {coreFacts.documentCount > 0 ? "✓" : "○"} Minst ett
                    kunskapsdokument ({coreFacts.documentCount} uppladdade)
                  </li>
                  <li className="pt-1">
                    <Link
                      href={`/train/${slug}`}
                      className="text-[var(--w-accent)] underline underline-offset-2"
                    >
                      Öppna Träna din AI →
                    </Link>
                  </li>
                </ul>
              )}
            </div>
          )}
        </section>

        {/* Röst */}
        <section>
          <h2 className={labelClass}>Röst</h2>
          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
            {VOICES.map((voice) => (
              <button
                key={voice.id}
                onClick={() => update("voice", voice.id)}
                aria-pressed={voiceAgent.voice === voice.id}
                className={`rounded-xl border p-4 text-left transition-colors motion-safe:duration-150 ${
                  voiceAgent.voice === voice.id
                    ? "border-[var(--w-accent)] bg-[var(--w-accent)]/10"
                    : "border-[var(--w-line)] bg-[var(--w-panel)] hover:border-[var(--w-muted)]"
                }`}
              >
                <p className="text-sm font-semibold">{voice.label}</p>
                <p className="mt-0.5 text-xs text-[var(--w-muted)]">
                  {voice.description}
                </p>
              </button>
            ))}
          </div>
        </section>

        {/* Samtalsinställningar */}
        <section>
          <h2 className={labelClass}>Samtalsinställningar</h2>
          <div className="mt-4 space-y-5">
            <div>
              <p className="mb-1 text-xs text-[var(--w-muted)]">Hälsningsfras</p>
              <textarea
                value={voiceAgent.greeting}
                onChange={(e) => update("greeting", e.target.value)}
                rows={2}
                placeholder={`Välkommen till ${restaurantName}! Vad kan jag hjälpa dig med?`}
                className={`${inputClass} resize-none rounded-lg border bg-[var(--w-panel)] px-3 py-2`}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <label className="text-sm">
                <span className="text-xs text-[var(--w-muted)]">
                  Max väntetid innan röstbrevlåda (sekunder)
                </span>
                <input
                  type="number"
                  min={5}
                  max={120}
                  value={voiceAgent.maxWaitSeconds}
                  onChange={(e) =>
                    update(
                      "maxWaitSeconds",
                      Math.min(120, Math.max(5, Number(e.target.value) || 20)),
                    )
                  }
                  className={`${inputClass} font-mono`}
                />
              </label>
              <label className="text-sm">
                <span className="text-xs text-[var(--w-muted)]">
                  Vidarekoppling till personal (nummer)
                </span>
                <input
                  type="tel"
                  value={voiceAgent.transferNumber}
                  onChange={(e) => update("transferNumber", e.target.value)}
                  placeholder="+46701234567"
                  className={`${inputClass} font-mono`}
                />
              </label>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
