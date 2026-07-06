"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import type { RestaurantConfig } from "@/lib/email-concierge/types";
import { FloorPlanner } from "./floor-planner";

// Ditt företag: grundläggande företagsuppgifter (namn, adress, öppettider)
// + bordskartan (rum och interaktiv bordsplacering). När allt är ifyllt
// låses "Träna din AI" upp på översikten.

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

type Props = {
  slug: string;
  initialName: string;
  initialConfig: RestaurantConfig;
  initialRooms: { id: string; name: string }[];
  initialFloorTables: {
    id: string;
    roomId: string | null;
    name: string;
    capacity: number;
    minSeats: number;
    shape: string;
    posX: number;
    posY: number;
    bookingCount: number;
  }[];
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

export function CompanyClient({
  slug,
  initialName,
  initialConfig,
  initialRooms,
  initialFloorTables,
}: Props) {
  const [name, setName] = useState(initialName);
  const [address, setAddress] = useState(initialConfig.address);
  const [hours, setHours] = useState(() => configToHours(initialConfig));
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
          <p className={labelClass}>Ditt företag</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight [font-family:var(--font-display),sans-serif]">
            {name || "Din restaurang"}
          </h1>
          <p className="mt-2 text-sm text-[var(--w-muted)]">
            Grundläggande uppgifter om restaurangen. När allt är ifyllt låses
            Träna din AI upp på översikten.
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
        </section>

        <FloorPlanner
          slug={slug}
          initialRooms={initialRooms}
          initialTables={initialFloorTables}
        />
      </main>
    </div>
  );
}
