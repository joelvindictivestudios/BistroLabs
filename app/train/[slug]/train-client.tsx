"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { BrandLogo } from "@/app/components/brand-logo";

// Träna din AI: policyer och dokumentuppladdning → kunskapsbasen (RAG) som
// driver widget-chatten, mejl-conciergen och telefonassistenten.
// Grundläggande företagsuppgifter fylls i under "Ditt företag".

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
  name: string;
  initialPolicies: Record<string, string>;
  initialDocuments: Doc[];
};

export function TrainClient({
  slug,
  name,
  initialPolicies,
  initialDocuments,
}: Props) {
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
    >
      <header className="flex h-16 items-center gap-4 border-b border-[var(--w-line)] px-6">
        <Link href={`/dashboard/${slug}`} aria-label="Till översikten">
          <BrandLogo />
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
