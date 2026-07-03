"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

// Onboarding för nya restauranger. Skapar restaurang + bord + öppettider +
// sittningar; widgeten blir live på /widget/{slug} direkt efter registrering.

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
type OfferingDraft = { title: string; description: string; imageUrl: string };

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[åä]/g, "a")
    .replace(/ö/g, "o")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 40);
}

export function RegisterForm() {
  const [name, setName] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [slug, setSlug] = useState("");
  const [email, setEmail] = useState("");
  const [menu, setMenu] = useState("");
  const [heroImageUrl, setHeroImageUrl] = useState("");
  const [hours, setHours] = useState<Record<DayKey, DayHours>>({
    mon: null,
    tue: { open: "17:00", close: "23:00" },
    wed: { open: "17:00", close: "23:00" },
    thu: { open: "17:00", close: "23:00" },
    fri: { open: "17:00", close: "23:00" },
    sat: { open: "17:00", close: "23:00" },
    sun: null,
  });
  const [tables, setTables] = useState({ two: 4, four: 3, six: 1 });
  const [offerings, setOfferings] = useState<OfferingDraft[]>([
    { title: "Middag", description: "", imageUrl: "" },
  ]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ widgetPath: string } | null>(null);

  const effectiveSlug = useMemo(
    () => (slugTouched ? slug : slugify(name)),
    [slug, slugTouched, name],
  );

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/restaurants", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          slug: effectiveSlug,
          email,
          menu,
          heroImageUrl,
          openingHours: hours,
          tables,
          offerings: offerings.filter((o) => o.title.trim()),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Registreringen misslyckades — prova igen.");
        return;
      }
      setResult(data);
    } catch {
      setError("Något gick fel — prova igen.");
    } finally {
      setSubmitting(false);
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
      <div className="mx-auto max-w-2xl px-6 py-12">
        <p className={labelClass}>BistroLabs</p>
        <h1 className="mt-1 text-3xl [font-family:var(--font-display),serif]">
          Registrera din restaurang
        </h1>
        <p className="mt-2 text-sm text-[var(--w-muted)]">
          Fyll i uppgifterna så är din bokningswidget live på ett par minuter.
        </p>

        {result ? (
          <div className="mt-10 rounded-lg border border-[var(--w-line)] bg-[var(--w-panel)] p-6">
            <p className="text-lg [font-family:var(--font-display),serif]">
              Klart — din widget är live!
            </p>
            <p className="mt-2 text-sm text-[var(--w-muted)]">
              Dela adressen med dina gäster eller bädda in den på er webbplats:
            </p>
            <Link
              href={result.widgetPath}
              className="mt-4 inline-block rounded-md bg-[var(--w-accent)] px-5 py-3 text-sm font-medium text-[#141210] hover:brightness-110 transition"
            >
              Öppna widgeten →
            </Link>
            <p className="mt-3 font-mono text-xs text-[var(--w-muted)]">
              {typeof window !== "undefined" ? window.location.origin : ""}
              {result.widgetPath}
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="mt-10 space-y-10">
            <section>
              <h2 className={labelClass}>Om restaurangen</h2>
              <div className="mt-4 space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <input
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Restaurangens namn"
                    className={inputClass}
                  />
                  <input
                    required
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="Kontakt-e-post"
                    className={inputClass}
                  />
                </div>
                <div>
                  <input
                    required
                    value={effectiveSlug}
                    onChange={(e) => {
                      setSlugTouched(true);
                      setSlug(slugify(e.target.value));
                    }}
                    placeholder="webbadress (slug)"
                    className={`${inputClass} font-mono`}
                  />
                  <p className="mt-1 text-xs text-[var(--w-muted)]">
                    Widgetens adress: /widget/{effectiveSlug || "…"}
                  </p>
                </div>
                <textarea
                  value={menu}
                  onChange={(e) => setMenu(e.target.value)}
                  placeholder="Kort om köket och menyn (visas för gäster och används av AI-chatten)"
                  rows={3}
                  className={`${inputClass} resize-none`}
                />
                <input
                  value={heroImageUrl}
                  onChange={(e) => setHeroImageUrl(e.target.value)}
                  placeholder="Bild-URL för widgetens högerpanel (valfritt)"
                  className={inputClass}
                />
              </div>
            </section>

            <section>
              <h2 className={labelClass}>Öppettider</h2>
              <div className="mt-4 space-y-2">
                {WEEKDAYS.map(({ key, label }) => {
                  const day = hours[key];
                  return (
                    <div key={key} className="flex items-center gap-3 text-sm">
                      <label className="flex w-28 items-center gap-2">
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
                        <span className="flex items-center gap-2 font-mono text-xs">
                          <input
                            type="time"
                            value={day.open}
                            onChange={(e) =>
                              setHours((h) => ({
                                ...h,
                                [key]: { ...day, open: e.target.value },
                              }))
                            }
                            className="rounded border border-[var(--w-line)] bg-[var(--w-panel)] px-2 py-1"
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
                            className="rounded border border-[var(--w-line)] bg-[var(--w-panel)] px-2 py-1"
                          />
                        </span>
                      ) : (
                        <span className="text-xs text-[var(--w-muted)]">
                          Stängt
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>

            <section>
              <h2 className={labelClass}>Bord</h2>
              <div className="mt-4 grid grid-cols-3 gap-4">
                {(
                  [
                    ["two", "2-personersbord"],
                    ["four", "4-personersbord"],
                    ["six", "6-personersbord"],
                  ] as const
                ).map(([key, label]) => (
                  <label key={key} className="text-sm">
                    <span className="text-xs text-[var(--w-muted)]">
                      {label}
                    </span>
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
            </section>

            <section>
              <h2 className={labelClass}>
                Sittningar — korten på widgetens startsida
              </h2>
              <div className="mt-4 space-y-3">
                {offerings.map((o, i) => (
                  <div
                    key={i}
                    className="rounded-lg border border-[var(--w-line)] bg-[var(--w-panel)] p-4 space-y-3"
                  >
                    <div className="flex items-center gap-3">
                      <input
                        value={o.title}
                        onChange={(e) =>
                          setOfferings((os) =>
                            os.map((x, j) =>
                              j === i ? { ...x, title: e.target.value } : x,
                            ),
                          )
                        }
                        placeholder={`Titel, t.ex. "Middag" eller "Brunch"`}
                        className={inputClass}
                      />
                      <button
                        type="button"
                        onClick={() =>
                          setOfferings((os) => os.filter((_, j) => j !== i))
                        }
                        aria-label={`Ta bort sittning ${i + 1}`}
                        className="text-[var(--w-muted)] hover:text-[var(--w-ink)] px-2"
                      >
                        ✕
                      </button>
                    </div>
                    <input
                      value={o.description}
                      onChange={(e) =>
                        setOfferings((os) =>
                          os.map((x, j) =>
                            j === i ? { ...x, description: e.target.value } : x,
                          ),
                        )
                      }
                      placeholder="Kort beskrivning (valfritt)"
                      className={inputClass}
                    />
                    <input
                      value={o.imageUrl}
                      onChange={(e) =>
                        setOfferings((os) =>
                          os.map((x, j) =>
                            j === i ? { ...x, imageUrl: e.target.value } : x,
                          ),
                        )
                      }
                      placeholder="Bild-URL (valfritt)"
                      className={inputClass}
                    />
                  </div>
                ))}
                {offerings.length < 8 && (
                  <button
                    type="button"
                    onClick={() =>
                      setOfferings((os) => [
                        ...os,
                        { title: "", description: "", imageUrl: "" },
                      ])
                    }
                    className="w-full h-11 rounded-md border border-dashed border-[var(--w-line)] text-sm text-[var(--w-muted)] hover:border-[var(--w-muted)] hover:text-[var(--w-ink)] transition"
                  >
                    + Lägg till sittning
                  </button>
                )}
              </div>
            </section>

            {error && <p className="text-sm text-[var(--w-accent)]">{error}</p>}

            <button
              type="submit"
              disabled={submitting || !name || !email || !effectiveSlug}
              className="w-full h-12 rounded-md bg-[var(--w-accent)] text-[#141210] text-sm font-medium tracking-wide hover:brightness-110 disabled:opacity-60 transition"
            >
              {submitting ? "Skapar…" : "Skapa restaurang & widget"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
