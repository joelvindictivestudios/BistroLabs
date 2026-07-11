"use client";

import { useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Search01Icon, UserAdd01Icon } from "@hugeicons/core-free-icons";

// Kundregistret: sök, skapa och redigera kunder. Regel: e-post ELLER telefon
// krävs, namn valfritt, plus fritext för allergier/övriga upplysningar.

export type CustomerRow = {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  notes: string;
  bookingCount: number;
  lastVisit: string | null;
  createdAt: string;
};

type Props = { slug: string; initialGuests: CustomerRow[] };

export function CustomersClient({ slug, initialGuests }: Props) {
  const [guests, setGuests] = useState<CustomerRow[]>(initialGuests);
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<CustomerRow | null>(null);
  const [error, setError] = useState<string | null>(null);

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
            Kunder
          </h1>
          <p className="mt-1 text-sm text-[var(--w-muted)]">
            Alla gäster som bokat via widget, telefon eller lagts in manuellt.
          </p>
        </div>
        <button
          onClick={() => {
            setShowForm((v) => !v);
            setEditing(null);
          }}
          className="flex h-10 items-center gap-2 rounded-xl bg-[var(--w-accent)] px-4 text-sm font-semibold text-[#141210] shadow-lg shadow-black/25 hover:brightness-110 transition"
        >
          <HugeiconsIcon icon={UserAdd01Icon} size={18} strokeWidth={1.8} />
          Ny kund
        </button>
      </div>

      {error && <p className="text-xs text-yellow-400">{error}</p>}

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
                  Inga kunder {query ? "matchade sökningen" : "ännu"}.
                </td>
              </tr>
            )}
            {guests.map((g) => (
              <tr key={g.id} className="hover:bg-[var(--w-panel)]/60">
                <td className="px-4 py-3">{g.name ?? "—"}</td>
                <td className="px-4 py-3 text-xs">
                  <div>{g.email ?? ""}</div>
                  <div className="font-mono text-[var(--w-muted)]">
                    {g.phone ?? ""}
                  </div>
                </td>
                <td className="px-4 py-3">{g.bookingCount}</td>
                <td className="max-w-56 truncate px-4 py-3 text-xs text-[var(--w-muted)]">
                  {g.notes || "—"}
                </td>
                <td className="px-4 py-3 text-right">
                  <button
                    onClick={() => {
                      setEditing(g);
                      setShowForm(false);
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
  onCancel,
}: {
  slug: string;
  existing: CustomerRow | null;
  onDone: (guest: CustomerRow) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(existing?.name ?? "");
  const [email, setEmail] = useState(existing?.email ?? "");
  const [phone, setPhone] = useState(existing?.phone ?? "");
  const [notes, setNotes] = useState(existing?.notes ?? "");
  const [saving, setSaving] = useState(false);
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
            }
          : data,
      );
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
        {existing ? "Redigera kund" : "Ny kund"}
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
      <p className="mt-2 text-xs text-[var(--w-muted)]">
        E-post eller telefonnummer krävs.
      </p>
      {error && <p className="mt-2 text-xs text-yellow-400">{error}</p>}
      <div className="mt-4 flex justify-end gap-2">
        <button
          onClick={onCancel}
          className="h-9 rounded-xl border border-[var(--w-line)] px-4 text-sm text-[var(--w-muted)] hover:text-[var(--w-ink)] transition"
        >
          Avbryt
        </button>
        <button
          onClick={() => void save()}
          disabled={saving}
          className="h-9 rounded-xl bg-[var(--w-accent)] px-4 text-sm font-semibold text-[#141210] hover:brightness-110 disabled:opacity-60 transition"
        >
          {saving ? "Sparar…" : existing ? "Spara ändringar" : "Skapa kund"}
        </button>
      </div>
    </div>
  );
}
