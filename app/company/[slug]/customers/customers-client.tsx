"use client";

import { useRef, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Search01Icon, UserAdd01Icon } from "@hugeicons/core-free-icons";
import { Avatar } from "@/app/components/avatar";
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
  // Curtain-panelen till höger (POC:ns gästpanel): radklick → profil,
  // "Redigera uppgifter" → formulär i samma panel, "Ny gäst" → tomt formulär
  const [drawer, setDrawer] = useState<
    | { mode: "profile"; guest: CustomerRow }
    | { mode: "edit"; guest: CustomerRow }
    | { mode: "create" }
    | null
  >(null);
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
            onClick={() => setDrawer({ mode: "create" })}
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

      {/* Gästtabellen (POC:ns anatomi): avatar + namn, mono-telefon,
          besök med no-show-suffix, senaste besök och märkningschips.
          Radklick öppnar curtain-panelen — redigering sker där. */}
      <div className="overflow-x-auto rounded-2xl border border-[var(--w-line)]">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--w-line)] bg-[var(--w-bg)] text-left text-[11px] uppercase tracking-[0.14em] text-[var(--w-muted)]">
              <th className="px-5 py-3.5 font-semibold">Gäst</th>
              <th className="px-4 py-3.5 font-semibold">Telefon</th>
              <th className="px-4 py-3.5 font-semibold">Besök</th>
              <th className="px-4 py-3.5 font-semibold">Senast</th>
              <th className="px-4 py-3.5 font-semibold">Märkning</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--w-line)]">
            {guests.length === 0 && (
              <tr>
                <td colSpan={5} className="px-5 py-6 text-[var(--w-muted)]">
                  Inga gäster {query ? "matchade sökningen" : "ännu"}.
                </td>
              </tr>
            )}
            {guests.map((g) => {
              const name = g.name ?? g.email ?? g.phone ?? "Gäst";
              const selected =
                drawer !== null &&
                drawer.mode !== "create" &&
                drawer.guest.id === g.id;
              return (
                <tr
                  key={g.id}
                  onClick={() => setDrawer({ mode: "profile", guest: g })}
                  aria-selected={selected}
                  className={`cursor-pointer transition-colors ${
                    selected
                      ? "bg-[var(--w-accent)]/5"
                      : "hover:bg-[var(--w-panel)]/60"
                  }`}
                >
                  <td className="px-5 py-3.5">
                    <div className="flex items-center gap-3">
                      <Avatar name={name} size={36} />
                      <span className="font-semibold">{name}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3.5 font-mono text-[13px] text-[var(--w-muted)]">
                    {g.phone ?? "—"}
                  </td>
                  <td className="px-4 py-3.5">
                    {g.visitCount}
                    {(g.noShowCount ?? 0) > 0 && (
                      <span className="ml-1.5 text-xs font-semibold text-status-late-fg">
                        · {g.noShowCount} no-show
                        {(g.noShowCount ?? 0) === 1 ? "" : "s"}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3.5 text-[var(--w-muted)]">
                    {g.lastVisit
                      ? new Date(g.lastVisit).toLocaleDateString("sv-SE", {
                          day: "numeric",
                          month: "short",
                        })
                      : "—"}
                  </td>
                  <td className="px-4 py-3.5">
                    <div className="flex flex-wrap gap-1.5">
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
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Curtain-panelen (POC:ns gpgDrawer): glider in från höger, ingen
          scrim — tabellen förblir klickbar så man kan bläddra mellan gäster */}
      {drawer && (
        <aside
          key={
            drawer.mode === "create"
              ? "create"
              : `${drawer.mode}-${drawer.guest.id}`
          }
          role="dialog"
          aria-label={
            drawer.mode === "profile"
              ? "Gästprofil"
              : drawer.mode === "edit"
                ? "Redigera gäst"
                : "Ny gäst"
          }
          className="fixed inset-y-0 right-0 z-40 w-[380px] max-w-[92vw] overflow-y-auto border-l border-[var(--w-line)] bg-[var(--w-panel)] shadow-2xl motion-safe:animate-drawer-in"
        >
          <div className="flex items-center justify-between border-b border-[var(--w-line)] px-5 py-4">
            <p className="text-[11px] uppercase tracking-[0.22em] text-[var(--w-muted)]">
              {drawer.mode === "profile"
                ? "Gästprofil"
                : drawer.mode === "edit"
                  ? "Redigera gäst"
                  : "Ny gäst"}
            </p>
            <button
              onClick={() => setDrawer(null)}
              aria-label="Stäng panelen"
              className="rounded-lg p-1.5 text-[var(--w-muted)] hover:text-[var(--w-ink)] transition"
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
          <div className="px-5 py-5">
            {drawer.mode === "profile" && (
              <CustomerProfile
                slug={slug}
                guest={drawer.guest}
                onEdit={() => setDrawer({ mode: "edit", guest: drawer.guest })}
              />
            )}
            {(drawer.mode === "edit" || drawer.mode === "create") && (
              <CustomerForm
                slug={slug}
                existing={drawer.mode === "edit" ? drawer.guest : null}
                onDone={(saved) => {
                  setGuests((gs) =>
                    drawer.mode === "edit"
                      ? gs.map((g) => (g.id === saved.id ? saved : g))
                      : [saved, ...gs],
                  );
                  setDrawer({ mode: "profile", guest: saved });
                }}
                onDeleted={(id) => {
                  setGuests((gs) => gs.filter((g) => g.id !== id));
                  setDrawer(null);
                }}
                onCancel={() =>
                  setDrawer(
                    drawer.mode === "edit"
                      ? { mode: "profile", guest: drawer.guest }
                      : null,
                  )
                }
              />
            )}
          </div>
        </aside>
      )}
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

  // Renderas i curtain-panelen — rubrik och kortchrome kommer därifrån
  return (
    <div>
      <div className="grid gap-4">
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
      <div className="mt-5 flex flex-wrap items-center gap-2">
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
