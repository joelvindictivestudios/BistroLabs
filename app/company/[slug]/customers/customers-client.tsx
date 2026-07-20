"use client";

import { useRef, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Search01Icon, UserAdd01Icon } from "@hugeicons/core-free-icons";
import { CustomerProfile } from "./customer-profile";

// Kundregistret: sök, skapa, redigera, importera (CSV) och radera kunder.
// Regel: e-post ELLER telefon krävs, namn valfritt, plus fritext för
// allergier/övriga upplysningar. Radering är hård (GDPR art 17).

export type CustomerRow = {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  notes: string;
  bookingCount: number;
  visitCount: number;
  marketingConsent: boolean;
  lastVisit: string | null;
  createdAt: string;
  /** Beräknas vid läsning (§3.12) — sökendpointen kan sakna fälten. */
  noShowCount?: number;
  tags?: string[];
};

type ImportSummary = {
  created: number;
  merged: number;
  skipped: number;
  errors: { row: number; message: string }[];
};

type Props = { slug: string; initialGuests: CustomerRow[] };

export function CustomersClient({ slug, initialGuests }: Props) {
  const [guests, setGuests] = useState<CustomerRow[]>(initialGuests);
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<CustomerRow | null>(null);
  // Gästprofilen (§3.12): radklick öppnar panelen med historik + märkningar
  const [viewing, setViewing] = useState<CustomerRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [importSummary, setImportSummary] = useState<ImportSummary | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function importCsv(file: File) {
    setImporting(true);
    setError(null);
    setImportSummary(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(`/api/restaurants/${slug}/guests/import`, {
        method: "POST",
        body: form,
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Importen misslyckades.");
        return;
      }
      setImportSummary(data);
      await search(query);
    } catch {
      setError("Importen misslyckades.");
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function search(q: string) {
    setSearching(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/restaurants/${slug}/guests?q=${encodeURIComponent(q)}`,
      );
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Sökningen misslyckades.");
        return;
      }
      setGuests(data.guests);
    } catch {
      setError("Sökningen misslyckades.");
    } finally {
      setSearching(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight [font-family:var(--font-display),sans-serif]">
            Gäster
          </h1>
          <p className="mt-1 text-sm text-[var(--w-muted)]">
            Alla gäster som bokat via widget, telefon eller lagts in manuellt.
          </p>
        </div>
        <div className="flex gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void importCsv(file);
            }}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={importing}
            title="CSV med kolumnerna namn, e-post, telefon, anteckning"
            className="h-10 rounded-xl border border-[var(--w-line)] px-4 text-sm text-[var(--w-muted)] hover:border-[var(--w-accent)] hover:text-[var(--w-ink)] disabled:opacity-50 transition"
          >
            {importing ? "Importerar…" : "Importera CSV"}
          </button>
          <button
            onClick={() => {
              setShowForm((v) => !v);
              setEditing(null);
            }}
            className="flex h-10 items-center gap-2 rounded-xl bg-[var(--w-accent)] px-4 text-sm font-semibold text-accent-on shadow-lg shadow-black/25 hover:brightness-110 transition"
          >
            <HugeiconsIcon icon={UserAdd01Icon} size={18} strokeWidth={1.8} />
            Ny gäst
          </button>
        </div>
      </div>

      {error && <p className="text-xs text-yellow-400">{error}</p>}

      {importSummary && (
        <div className="flex items-start justify-between gap-4 rounded-xl border border-[var(--w-line)] bg-[var(--w-panel)] px-4 py-3 text-sm">
          <div>
            <p>
              {importSummary.created} importerade · {importSummary.merged}{" "}
              sammanslagna · {importSummary.skipped} hoppades över
            </p>
            {importSummary.errors.length > 0 && (
              <ul className="mt-1 space-y-0.5 text-xs text-[var(--w-muted)]">
                {importSummary.errors.map((e) => (
                  <li key={e.row}>
                    Rad {e.row}: {e.message}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <button
            onClick={() => setImportSummary(null)}
            aria-label="Stäng"
            className="text-xs text-[var(--w-muted)] hover:text-[var(--w-ink)]"
          >
            ✕
          </button>
        </div>
      )}

      {viewing && !editing && !showForm && (
        <CustomerProfile
          slug={slug}
          guest={viewing}
          onEdit={() => {
            setEditing(viewing);
            setViewing(null);
          }}
          onClose={() => setViewing(null)}
        />
      )}

      {(showForm || editing) && (
        <CustomerForm
          slug={slug}
          existing={editing}
          onDone={(saved) => {
            if (editing) {
              setGuests((gs) =>
                gs.map((g) => (g.id === saved.id ? saved : g)),
              );
            } else {
              setGuests((gs) => [saved, ...gs]);
            }
            setShowForm(false);
            setEditing(null);
          }}
          onDeleted={(id) => {
            setGuests((gs) => gs.filter((g) => g.id !== id));
            setShowForm(false);
            setEditing(null);
          }}
          onCancel={() => {
            setShowForm(false);
            setEditing(null);
          }}
        />
      )}

      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <HugeiconsIcon
            icon={Search01Icon}
            size={17}
            strokeWidth={1.8}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--w-muted)]"
          />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void search(query);
            }}
            placeholder="Sök på namn, e-post eller telefon…"
            className="h-10 w-full rounded-xl border border-[var(--w-line)] bg-[var(--w-panel)] pl-10 pr-3 text-sm placeholder:text-[var(--w-muted)]/60 focus:border-[var(--w-accent)] focus:outline-none"
          />
        </div>
        <button
          onClick={() => void search(query)}
          disabled={searching}
          className="h-10 rounded-xl border border-[var(--w-line)] px-4 text-sm hover:border-[var(--w-accent)] disabled:opacity-50 transition"
        >
          {searching ? "Söker…" : "Sök"}
        </button>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-[var(--w-line)]">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--w-line)] text-left text-[11px] uppercase tracking-wider text-[var(--w-muted)]">
              <th className="px-4 py-3 font-medium">Namn</th>
              <th className="px-4 py-3 font-medium">Kontakt</th>
              <th className="px-4 py-3 font-medium">Bokningar</th>
              <th className="px-4 py-3 font-medium">Upplysningar</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--w-line)]">
            {guests.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-[var(--w-muted)]">
                  Inga gäster {query ? "matchade sökningen" : "ännu"}.
                </td>
              </tr>
            )}
            {guests.map((g) => (
              <tr
                key={g.id}
                onClick={() => {
                  setViewing(g);
                  setEditing(null);
                  setShowForm(false);
                }}
                className="cursor-pointer hover:bg-[var(--w-panel)]/60"
              >
                <td className="px-4 py-3">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span>{g.name ?? "—"}</span>
                    {(g.tags ?? []).map((t) => (
                      <span
                        key={t}
                        className={`rounded-full border px-2 py-0.5 text-[10px] font-medium capitalize ${
                          t === "allergi"
                            ? "border-status-late-border bg-status-late-bg text-status-late-fg"
                            : t === "stamgäst"
                              ? "border-status-booked-border bg-status-booked-bg text-status-booked-fg"
                              : "border-status-pending-border bg-status-pending-bg text-status-pending-fg"
                        }`}
                      >
                        {t}
                      </span>
                    ))}
                  </div>
                </td>
                <td className="px-4 py-3 text-xs">
                  <div>{g.email ?? ""}</div>
                  <div className="font-mono text-[var(--w-muted)]">
                    {g.phone ?? ""}
                  </div>
                </td>
                <td className="px-4 py-3">
                  {g.bookingCount}
                  {(g.noShowCount ?? 0) > 0 && (
                    <span className="ml-1.5 text-xs font-semibold text-status-late-fg">
                      · {g.noShowCount} no-show
                      {(g.noShowCount ?? 0) === 1 ? "" : "s"}
                    </span>
                  )}
                </td>
                <td className="max-w-56 truncate px-4 py-3 text-xs text-[var(--w-muted)]">
                  {g.notes || "—"}
                </td>
                <td className="px-4 py-3 text-right">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setEditing(g);
                      setShowForm(false);
                      setViewing(null);
                    }}
                    className="rounded-lg border border-[var(--w-line)] px-3 py-1 text-xs text-[var(--w-muted)] hover:border-[var(--w-accent)] hover:text-[var(--w-ink)] transition"
                  >
                    Redigera
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function CustomerForm({
  slug,
  existing,
  onDone,
  onDeleted,
  onCancel,
}: {
  slug: string;
  existing: CustomerRow | null;
  onDone: (guest: CustomerRow) => void;
  onDeleted?: (guestId: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(existing?.name ?? "");
  const [email, setEmail] = useState(existing?.email ?? "");
  const [phone, setPhone] = useState(existing?.phone ?? "");
  const [notes, setNotes] = useState(existing?.notes ?? "");
  const [marketingConsent, setMarketingConsent] = useState(
    existing?.marketingConsent ?? false,
  );
  const [saving, setSaving] = useState(false);
  const [deleteArmed, setDeleteArmed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!email.trim() && !phone.trim()) {
      setError("Ange e-post eller telefonnummer.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const payload = {
        name: name.trim() || undefined,
        email: email.trim() || undefined,
        phone: phone.trim() || undefined,
        notes: notes.trim() || undefined,
      };
      const res = existing
        ? await fetch(`/api/restaurants/${slug}/guests/${existing.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              name: name.trim() || null,
              email: email.trim() || null,
              phone: phone.trim() || null,
              notes: notes.trim(),
              marketingConsent,
            }),
          })
        : await fetch(`/api/restaurants/${slug}/guests`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Kunde inte spara kunden.");
        return;
      }
      onDone(
        existing
          ? {
              ...existing,
              name: name.trim() || null,
              email: email.trim() || null,
              phone: phone.trim() || null,
              notes: notes.trim(),
              marketingConsent,
            }
          : data,
      );
    } catch {
      setError("Något gick fel — prova igen.");
    } finally {
      setSaving(false);
    }
  }

  async function deleteCustomer() {
    if (!existing) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/restaurants/${slug}/guests/${existing.id}`,
        { method: "DELETE" },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Kunde inte radera kunden.");
        return;
      }
      onDeleted?.(existing.id);
    } catch {
      setError("Något gick fel — prova igen.");
    } finally {
      setSaving(false);
    }
  }

  const inputClass =
    "w-full bg-transparent border-b border-[var(--w-line)] py-2 text-sm placeholder:text-[var(--w-muted)]/60 focus:border-[var(--w-accent)] focus:outline-none";

  return (
    <div className="rounded-2xl border border-[var(--w-line)] bg-[var(--w-panel)] p-5">
      <p className="text-[11px] uppercase tracking-[0.22em] text-[var(--w-muted)]">
        {existing ? "Redigera gäst" : "Ny gäst"}
      </p>
      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Namn (valfritt)"
          className={inputClass}
        />
        <input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          type="email"
          placeholder="E-post"
          className={inputClass}
        />
        <input
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="Telefon"
          className={inputClass}
        />
      </div>
      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        rows={2}
        placeholder="Övriga upplysningar / allergier (valfritt)"
        className={`${inputClass} mt-4 resize-none rounded-lg border bg-[var(--w-bg)] px-3 py-2`}
      />
      {existing && (
        <label className="mt-4 flex items-center gap-2.5 text-sm">
          <input
            type="checkbox"
            checked={marketingConsent}
            onChange={(e) => setMarketingConsent(e.target.checked)}
            className="h-4 w-4 accent-[var(--w-accent)]"
          />
          <span>
            Samtycker till utskick{" "}
            <span className="text-xs text-[var(--w-muted)]">
              — erbjudanden via e-post/SMS (krävs inte för bekräftelser)
            </span>
          </span>
        </label>
      )}
      <p className="mt-2 text-xs text-[var(--w-muted)]">
        E-post eller telefonnummer krävs.
      </p>
      {error && <p className="mt-2 text-xs text-yellow-400">{error}</p>}
      <div className="mt-4 flex items-center gap-2">
        {existing &&
          (deleteArmed ? (
            <span className="flex items-center gap-2 rounded-xl border border-status-late-border bg-status-late-bg px-3 py-1.5">
              <span className="text-xs font-medium text-status-late-fg">
                Raderar alla uppgifter permanent.
              </span>
              <button
                onClick={() => void deleteCustomer()}
                disabled={saving}
                className="rounded-lg bg-[#b5503f] px-3 py-1.5 text-xs font-semibold text-white hover:brightness-110 disabled:opacity-60 transition"
              >
                Ja, radera
              </button>
              <button
                onClick={() => setDeleteArmed(false)}
                className="rounded-lg border border-[var(--w-line)] px-3 py-1.5 text-xs text-[var(--w-muted)] hover:text-[var(--w-ink)] transition"
              >
                Ångra
              </button>
            </span>
          ) : (
            <button
              onClick={() => setDeleteArmed(true)}
              className="h-9 rounded-xl border border-[#5c3a30] px-4 text-sm font-medium text-[#d1786a] hover:bg-status-late-bg transition"
            >
              Radera gäst…
            </button>
          ))}
        <span className="ml-auto flex gap-2">
          <button
            onClick={onCancel}
            className="h-9 rounded-xl border border-[var(--w-line)] px-4 text-sm text-[var(--w-muted)] hover:text-[var(--w-ink)] transition"
          >
            Avbryt
          </button>
          <button
            onClick={() => void save()}
            disabled={saving}
            className="h-9 rounded-xl bg-[var(--w-accent)] px-4 text-sm font-semibold text-accent-on hover:brightness-110 disabled:opacity-60 transition"
          >
            {saving ? "Sparar…" : existing ? "Spara ändringar" : "Skapa gäst"}
          </button>
        </span>
      </div>
    </div>
  );
}
