"use client";

import { useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import type { RestaurantConfig } from "@/lib/email-concierge/types";

// Träna din AI: grundinfo (delas med widget-editorn via samma config),
// policyer och dokumentuppladdning → kunskapsbasen (RAG) som driver
// widget-chatten, mejl-conciergen och kommande telefonassistenten.

const WEEKDAYS = [
  { key: "mon", label: "Måndag" },
  { key: "tue", label: "Tisdag" },
  { key: "wed", label: "Onsdag" },
  { key: "thu", label: "Torsdag" },
  { key: "fri", label: "Fredag" },
  { key: "sat", label: "Lördag" },
  { key: "sun", label: "Söndag" },
] as const;

type DayKey = (typeof WEEKDAYS)[number]["key"];
type DayHours = { open: string; close: string } | null;
type Tables = { two: number; four: number; six: number };
type Doc = { id: string; category: string; title: string };

const CATEGORY_LABELS: Record<string, string> = {
  menu: "Meny",
  wine: "Vinlista",
  policy: "Policy",
  faq: "FAQ",
  other: "Övrigt",
};

const POLICY_TITLES = ["Avbokningspolicy", "Allergihantering"] as const;

type Props = {
  slug: string;
  initialName: string;
  initialConfig: RestaurantConfig;
  initialTables: Tables;
  tablesLocked: boolean;
  initialPolicies: Record<string, string>;
  initialDocuments: Doc[];
};

function configToHours(config: RestaurantConfig): Record<DayKey, DayHours> {
  const hours = {} as Record<DayKey, DayHours>;
  for (const { key } of WEEKDAYS) {
    const ranges = config.openingHours[key] ?? [];
    hours[key] = ranges.length
      ? { open: ranges[0].open, close: ranges[0].close }
      : null;
  }
  return hours;
}

export function TrainClient({
  slug,
  initialName,
  initialConfig,
  initialTables,
  tablesLocked,
  initialPolicies,
  initialDocuments,
}: Props) {
  const [name, setName] = useState(initialName);
  const [address, setAddress] = useState(initialConfig.address);
  const [hours, setHours] = useState(() => configToHours(initialConfig));
  const [tables, setTables] = useState<Tables>(initialTables);
  const [policies, setPolicies] =
    useState<Record<string, string>>(initialPolicies);
  const [documents, setDocuments] = useState<Doc[]>(initialDocuments);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function saveAll() {
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
          openingHours: hours,
          ...(tablesLocked ? {} : { tables }),
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error ?? "Kunde inte spara.");
        return;
      }
      for (const title of POLICY_TITLES) {
        const policyRes = await fetch(`/api/restaurants/${slug}/policies`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title, content: policies[title] ?? "" }),
        });
        if (!policyRes.ok) {
          const data = await policyRes.json();
          setError(data.error ?? `Kunde inte spara ${title}.`);
          return;
        }
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
          {error && <span className="text-xs text-yellow-400">{error}</span>}
          {savedAt && !error && (
            <span className="text-xs text-emerald-400">Sparat ✓</span>
          )}
          <button
            onClick={saveAll}
            disabled={saving}
            className="h-10 rounded-xl bg-[var(--w-accent)] px-5 text-sm font-semibold text-[#141210] shadow-lg shadow-black/25 hover:brightness-110 disabled:opacity-60 transition"
          >
            {saving ? "Sparar…" : "Spara"}
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-6 py-10 space-y-12">
        <div>
          <p className={labelClass}>Träna din AI</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight [font-family:var(--font-display),sans-serif]">
            {name || "Din restaurang"}
          </h1>
          <p className="mt-2 text-sm text-[var(--w-muted)]">
            Allt du fyller i här används av widget-chatten, mejlsvaren och
            telefonassistenten.
          </p>
        </div>

        <section>
          <h2 className={labelClass}>Grundinfo</h2>
          <div className="mt-4 space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Restaurangens namn"
                className={inputClass}
              />
              <input
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="Adress, t.ex. Storgatan 1, Stockholm"
                className={inputClass}
              />
            </div>
          </div>
          <div className="mt-6 space-y-2">
            {WEEKDAYS.map(({ key, label }) => {
              const day = hours[key];
              return (
                <div key={key} className="flex items-center gap-3 text-sm">
                  <label className="flex w-24 items-center gap-2">
                    <input
                      type="checkbox"
                      checked={day !== null}
                      onChange={(e) =>
                        setHours((h) => ({
                          ...h,
                          [key]: e.target.checked
                            ? { open: "17:00", close: "23:00" }
                            : null,
                        }))
                      }
                      className="accent-[var(--w-accent)]"
                    />
                    {label}
                  </label>
                  {day ? (
                    <span className="flex items-center gap-1.5 font-mono text-xs">
                      <input
                        type="time"
                        value={day.open}
                        onChange={(e) =>
                          setHours((h) => ({
                            ...h,
                            [key]: { ...day, open: e.target.value },
                          }))
                        }
                        className="rounded-lg border border-[var(--w-line)] bg-[var(--w-panel)] px-1.5 py-1"
                      />
                      –
                      <input
                        type="time"
                        value={day.close}
                        onChange={(e) =>
                          setHours((h) => ({
                            ...h,
                            [key]: { ...day, close: e.target.value },
                          }))
                        }
                        className="rounded-lg border border-[var(--w-line)] bg-[var(--w-panel)] px-1.5 py-1"
                      />
                    </span>
                  ) : (
                    <span className="text-xs text-[var(--w-muted)]">Stängt</span>
                  )}
                </div>
              );
            })}
          </div>
          <div className="mt-6">
            <p className="text-xs text-[var(--w-muted)] mb-2">Bordskapacitet</p>
            {tablesLocked ? (
              <p className="text-xs text-[var(--w-muted)]">
                Borden är låsta eftersom det finns bokningar.
              </p>
            ) : (
              <div className="grid grid-cols-3 gap-4">
                {(
                  [
                    ["two", "2 pers"],
                    ["four", "4 pers"],
                    ["six", "6 pers"],
                  ] as const
                ).map(([key, label]) => (
                  <label key={key} className="text-sm">
                    <span className="text-xs text-[var(--w-muted)]">{label}</span>
                    <input
                      type="number"
                      min={0}
                      max={50}
                      value={tables[key]}
                      onChange={(e) =>
                        setTables((t) => ({
                          ...t,
                          [key]: Math.max(0, Number(e.target.value) || 0),
                        }))
                      }
                      className={`${inputClass} font-mono`}
                    />
                  </label>
                ))}
              </div>
            )}
          </div>
        </section>

        <section>
          <h2 className={labelClass}>Policyer</h2>
          <div className="mt-4 space-y-5">
            {POLICY_TITLES.map((title) => (
              <div key={title}>
                <p className="mb-1 text-xs text-[var(--w-muted)]">{title}</p>
                <textarea
                  value={policies[title] ?? ""}
                  onChange={(e) =>
                    setPolicies((p) => ({ ...p, [title]: e.target.value }))
                  }
                  rows={3}
                  placeholder={
                    title === "Avbokningspolicy"
                      ? "T.ex: Avbokning är kostnadsfri fram till 24 timmar före bokad tid…"
                      : "T.ex: Vi hanterar alla vanliga allergier — meddela vid bokning…"
                  }
                  className={`${inputClass} resize-none rounded-lg border bg-[var(--w-panel)] px-3 py-2`}
                />
              </div>
            ))}
          </div>
        </section>

        <DocumentsSection
          slug={slug}
          documents={documents}
          onChange={setDocuments}
          onError={setError}
        />
      </main>
    </div>
  );
}

function DocumentsSection({
  slug,
  documents,
  onChange,
  onError,
}: {
  slug: string;
  documents: Doc[];
  onChange: (docs: Doc[] | ((d: Doc[]) => Doc[])) => void;
  onError: (msg: string | null) => void;
}) {
  const [category, setCategory] = useState("menu");
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleFile(file: File) {
    setUploading(true);
    onError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("category", category);
      const res = await fetch(`/api/restaurants/${slug}/documents`, {
        method: "POST",
        body: form,
      });
      const data = await res.json();
      if (!res.ok) {
        onError(data.error ?? "Uppladdningen misslyckades.");
        return;
      }
      const newDocs: Doc[] = data.documentIds.map((id: string, i: number) => ({
        id,
        category,
        title:
          data.chunks > 1 ? `${data.title} (del ${i + 1})` : data.title,
      }));
      onChange((docs) => [...newDocs, ...docs]);
    } catch {
      onError("Uppladdningen misslyckades — prova igen.");
    } finally {
      setUploading(false);
    }
  }

  async function handleDelete(id: string) {
    const res = await fetch(`/api/restaurants/${slug}/documents/${id}`, {
      method: "DELETE",
    });
    if (res.ok) onChange((docs) => docs.filter((d) => d.id !== id));
  }

  return (
    <section>
      <h2 className="text-[11px] uppercase tracking-[0.22em] text-[var(--w-muted)]">
        Dokument — meny, vinlista, husets historia
      </h2>
      <p className="mt-1 text-xs text-[var(--w-muted)]">
        PDF, .txt eller .md. Innehållet delas upp och blir sökbart för AI:n.
      </p>

      <div className="mt-4 flex items-center gap-3">
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="h-10 rounded-lg border border-[var(--w-line)] bg-[var(--w-panel)] px-3 text-sm focus:border-[var(--w-accent)] focus:outline-none"
        >
          <option value="menu">Meny</option>
          <option value="wine">Vinlista</option>
          <option value="other">Övrigt</option>
        </select>
        <input
          ref={inputRef}
          type="file"
          accept=".pdf,.txt,.md,application/pdf,text/plain,text/markdown"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFile(file);
            e.target.value = "";
          }}
        />
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className="h-10 rounded-xl border border-[var(--w-line)] px-4 text-sm hover:border-[var(--w-accent)] disabled:opacity-50 transition"
        >
          {uploading ? "Laddar upp & tränar…" : "Ladda upp dokument"}
        </button>
      </div>

      {documents.length > 0 && (
        <ul className="mt-5 divide-y divide-[var(--w-line)] rounded-xl border border-[var(--w-line)] bg-[var(--w-panel)]">
          {documents.map((doc) => (
            <li
              key={doc.id}
              className="flex items-center gap-3 px-4 py-3 text-sm"
            >
              <span className="rounded-full border border-[var(--w-line)] px-2 py-0.5 text-[10px] uppercase tracking-wider text-[var(--w-muted)]">
                {CATEGORY_LABELS[doc.category] ?? doc.category}
              </span>
              <span className="truncate">{doc.title}</span>
              <button
                type="button"
                onClick={() => handleDelete(doc.id)}
                aria-label={`Ta bort ${doc.title}`}
                className="ml-auto text-[var(--w-muted)] hover:text-[var(--w-ink)] transition-colors"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
