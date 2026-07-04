"use client";

import { useMemo, useRef, useState, useSyncExternalStore } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { getBrowserSupabase } from "@/lib/auth/client";
import type { RestaurantConfig } from "@/lib/email-concierge/types";
import { BookingWidget } from "@/app/widget/[slug]/booking-widget";

// Widget-editorn: panel till vänster, den riktiga widgeten live till höger.
// Spara = PATCH; Publicera = PATCH med published: true → kopierbar delningslänk.

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
type Offering = { id: string; title: string; description: string; imageUrl: string };
type Tables = { two: number; four: number; six: number };

type Draft = {
  name: string;
  menu: string;
  heroImageUrl: string;
  logoUrl: string;
  offerings: Offering[];
  hours: Record<DayKey, DayHours>;
  tables: Tables;
};

type Props = {
  slug: string;
  initialName: string;
  initialPublished: boolean;
  initialConfig: RestaurantConfig;
  initialTables: Tables;
  tablesLocked: boolean;
  userEmail: string;
  previewFontClass: string;
};

function configToHours(config: RestaurantConfig): Record<DayKey, DayHours> {
  const hours = {} as Record<DayKey, DayHours>;
  for (const { key } of WEEKDAYS) {
    const ranges = config.openingHours[key] ?? [];
    hours[key] = ranges.length ? { open: ranges[0].open, close: ranges[0].close } : null;
  }
  return hours;
}

export function EditorClient({
  slug,
  initialName,
  initialPublished,
  initialConfig,
  initialTables,
  tablesLocked,
  userEmail,
  previewFontClass,
}: Props) {
  const router = useRouter();
  const makeDraft = (): Draft => ({
    name: initialName,
    menu: initialConfig.menu,
    heroImageUrl: initialConfig.heroImageUrl,
    logoUrl: initialConfig.logoUrl,
    offerings: initialConfig.offerings.map((o) => ({ ...o })),
    hours: configToHours(initialConfig),
    tables: { ...initialTables },
  });

  const [draft, setDraft] = useState<Draft>(makeDraft);
  const [savedSnapshot, setSavedSnapshot] = useState(() =>
    JSON.stringify(makeDraft()),
  );
  const [published, setPublished] = useState(initialPublished);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  // Origin finns bara i webbläsaren (blir bistrolabs.se i produktion);
  // useSyncExternalStore hanterar server/klient-skillnaden utan hydration-fel
  const origin = useSyncExternalStore(
    () => () => {},
    () => window.location.origin,
    () => "",
  );
  const widgetUrl = `${origin}/widget/${slug}`;

  const dirty = JSON.stringify(draft) !== savedSnapshot;

  const update = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  async function save(alsoPublish?: boolean): Promise<boolean> {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/restaurants/${slug}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: draft.name,
          menu: draft.menu,
          heroImageUrl: draft.heroImageUrl,
          logoUrl: draft.logoUrl,
          openingHours: draft.hours,
          offerings: draft.offerings.filter((o) => o.title.trim()),
          ...(tablesLocked ? {} : { tables: draft.tables }),
          ...(alsoPublish !== undefined ? { published: alsoPublish } : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Kunde inte spara — prova igen.");
        return false;
      }
      setSavedSnapshot(JSON.stringify(draft));
      if (alsoPublish !== undefined) setPublished(alsoPublish);
      return true;
    } catch {
      setError("Något gick fel — prova igen.");
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function copyLink() {
    await navigator.clipboard.writeText(widgetUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  // Preview-props ur draften — uppdateras direkt när man ändrar i panelen
  const preview = useMemo(() => {
    const openDays = WEEKDAYS.filter(({ key }) => draft.hours[key]).map((d) => d.key);
    return {
      openDays,
      hoursDisplay: WEEKDAYS.filter(({ key }) => draft.hours[key]).map(
        ({ key, label }) => ({
          day: label,
          hours: `${draft.hours[key]!.open}–${draft.hours[key]!.close}`,
        }),
      ),
      offerings: draft.offerings.filter((o) => o.title.trim()),
    };
  }, [draft]);

  const inputClass =
    "w-full bg-transparent border-b border-[var(--w-line)] py-2 text-sm placeholder:text-[var(--w-muted)]/60 focus:border-[var(--w-accent)] focus:outline-none";
  const labelClass = "text-[11px] uppercase tracking-[0.22em] text-[var(--w-muted)]";

  return (
    <div
      className="h-dvh flex flex-col bg-[var(--w-bg)] text-[var(--w-ink)]"
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
      {/* Toppbar */}
      <header className="flex h-16 shrink-0 items-center gap-4 border-b border-[var(--w-line)] px-5">
        <Image
          src="/BLWhiteSide.png"
          alt="BistroLabs"
          width={138}
          height={30}
          className="h-7 w-auto"
        />
        <span
          className={`rounded-full border mt-2 px-3 py-1 text-[11px] font-medium ${
            published
              ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400"
              : "border-[var(--w-line)] bg-[var(--w-panel)] text-[var(--w-muted)]"
          }`}
        >
          {published ? "Publicerad" : "Utkast"}
        </span>
        {dirty && (
          <span className="rounded-full border mt-2 border-yellow-500/40 bg-yellow-500/10 px-3 py-1 text-[11px] font-medium text-yellow-400">
            Spara dina ändringar
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          {error && <span className="text-xs text-[var(--w-accent)]">{error}</span>}
          {published && (
            <>
              <div className="flex h-10 items-center overflow-hidden rounded-xl border border-[var(--w-line)]">
                <a
                  href={widgetUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="max-w-[280px] truncate px-3 font-mono text-xs text-[var(--w-muted)] hover:text-[var(--w-ink)] transition-colors"
                  title={widgetUrl}
                >
                  {widgetUrl}
                </a>
                <button
                  onClick={copyLink}
                  className="h-full shrink-0 border-l border-[var(--w-line)] px-3 text-xs text-[var(--w-accent)] hover:bg-[var(--w-panel)] transition"
                >
                  {copied ? "Kopierad ✓" : "Kopiera"}
                </button>
              </div>
              <button
                onClick={() => save(false)}
                disabled={saving}
                className="h-10 rounded-xl border border-[var(--w-line)] px-4 text-sm text-[var(--w-muted)] hover:text-[var(--w-ink)] disabled:opacity-50 transition"
              >
                Avpublicera
              </button>
            </>
          )}
          <button
            onClick={() => save()}
            disabled={saving || !dirty}
            className="h-10 rounded-xl border border-[var(--w-line)] px-4 text-sm hover:border-[var(--w-accent)] disabled:opacity-40 transition"
          >
            {saving ? "Sparar…" : "Spara"}
          </button>
          {!published && (
            <button
              onClick={() => save(true)}
              disabled={saving}
              className="h-10 rounded-xl bg-[var(--w-accent)] px-5 text-sm font-semibold text-[#141210] shadow-lg shadow-black/25 hover:brightness-110 disabled:opacity-60 transition"
            >
              Publicera
            </button>
          )}
          <button
            onClick={async () => {
              await getBrowserSupabase().auth.signOut();
              router.push("/login");
              router.refresh();
            }}
            className="ml-2 text-xs text-[var(--w-muted)] hover:text-[var(--w-ink)] transition-colors"
            title={userEmail}
          >
            Logga ut
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* Redigeringspanel */}
        <aside className="w-[380px] shrink-0 overflow-y-auto border-r border-[var(--w-line)] p-6 space-y-9">
          <section>
            <h2 className={labelClass}>Om restaurangen</h2>
            <div className="mt-3 space-y-4">
              <input
                value={draft.name}
                onChange={(e) => update("name", e.target.value)}
                placeholder="Restaurangens namn"
                className={inputClass}
              />
              <textarea
                value={draft.menu}
                onChange={(e) => update("menu", e.target.value)}
                placeholder="Kort om köket och menyn (visas i widgeten och används av AI-chatten)"
                rows={3}
                className={`${inputClass} resize-none`}
              />
            </div>
          </section>

          <section>
            <h2 className={labelClass}>Hero-bild — högerpanelen</h2>
            <div className="mt-3">
              <ImageUpload
                slug={slug}
                value={draft.heroImageUrl}
                onChange={(url) => update("heroImageUrl", url)}
                onError={setError}
              />
            </div>
          </section>

          <section>
            <h2 className={labelClass}>Logga — visas på hero-bilden</h2>
            <p className="mt-1 text-xs text-[var(--w-muted)]">
              Ersätter namnet i text. Transparent PNG fungerar bäst.
            </p>
            <div className="mt-3">
              <ImageUpload
                slug={slug}
                value={draft.logoUrl}
                onChange={(url) => update("logoUrl", url)}
                onError={setError}
              />
            </div>
          </section>

          <section>
            <h2 className={labelClass}>Sittningar — startsidans kort</h2>
            <div className="mt-3 space-y-3">
              {draft.offerings.map((o, i) => (
                <div
                  key={o.id || i}
                  className="rounded-xl border border-[var(--w-line)] bg-[var(--w-panel)] p-4 space-y-3"
                >
                  <div className="flex items-center gap-2">
                    <input
                      value={o.title}
                      onChange={(e) =>
                        update(
                          "offerings",
                          draft.offerings.map((x, j) =>
                            j === i ? { ...x, title: e.target.value } : x,
                          ),
                        )
                      }
                      placeholder="Titel"
                      className={inputClass}
                    />
                    <button
                      type="button"
                      onClick={() =>
                        update(
                          "offerings",
                          draft.offerings.filter((_, j) => j !== i),
                        )
                      }
                      aria-label={`Ta bort ${o.title || "sittning"}`}
                      className="px-2 text-[var(--w-muted)] hover:text-[var(--w-ink)]"
                    >
                      ✕
                    </button>
                  </div>
                  <input
                    value={o.description}
                    onChange={(e) =>
                      update(
                        "offerings",
                        draft.offerings.map((x, j) =>
                          j === i ? { ...x, description: e.target.value } : x,
                        ),
                      )
                    }
                    placeholder="Kort beskrivning (valfritt)"
                    className={inputClass}
                  />
                  <ImageUpload
                    slug={slug}
                    value={o.imageUrl}
                    compact
                    onChange={(url) =>
                      update(
                        "offerings",
                        draft.offerings.map((x, j) =>
                          j === i ? { ...x, imageUrl: url } : x,
                        ),
                      )
                    }
                    onError={setError}
                  />
                </div>
              ))}
              {draft.offerings.length < 8 && (
                <button
                  type="button"
                  onClick={() =>
                    update("offerings", [
                      ...draft.offerings,
                      {
                        id: `offering-${Date.now()}`,
                        title: "",
                        description: "",
                        imageUrl: "",
                      },
                    ])
                  }
                  className="w-full h-11 rounded-xl border border-dashed border-[var(--w-line)] text-sm text-[var(--w-muted)] hover:border-[var(--w-muted)] hover:text-[var(--w-ink)] transition"
                >
                  + Lägg till sittning
                </button>
              )}
            </div>
          </section>

          <section>
            <h2 className={labelClass}>Öppettider</h2>
            <div className="mt-3 space-y-2">
              {WEEKDAYS.map(({ key, label }) => {
                const day = draft.hours[key];
                return (
                  <div key={key} className="flex items-center gap-3 text-sm">
                    <label className="flex w-24 items-center gap-2">
                      <input
                        type="checkbox"
                        checked={day !== null}
                        onChange={(e) =>
                          update("hours", {
                            ...draft.hours,
                            [key]: e.target.checked
                              ? { open: "17:00", close: "23:00" }
                              : null,
                          })
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
                            update("hours", {
                              ...draft.hours,
                              [key]: { ...day, open: e.target.value },
                            })
                          }
                          className="rounded-lg border border-[var(--w-line)] bg-[var(--w-panel)] px-1.5 py-1"
                        />
                        –
                        <input
                          type="time"
                          value={day.close}
                          onChange={(e) =>
                            update("hours", {
                              ...draft.hours,
                              [key]: { ...day, close: e.target.value },
                            })
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

          <section>
            <h2 className={labelClass}>Bord</h2>
            {tablesLocked ? (
              <p className="mt-3 text-xs text-[var(--w-muted)]">
                Borden är låsta eftersom det finns bokningar. Kontakta support
                för att ändra bordsuppsättningen.
              </p>
            ) : (
              <div className="mt-3 grid grid-cols-3 gap-4">
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
                      value={draft.tables[key]}
                      onChange={(e) =>
                        update("tables", {
                          ...draft.tables,
                          [key]: Math.max(0, Number(e.target.value) || 0),
                        })
                      }
                      className={`${inputClass} font-mono`}
                    />
                  </label>
                ))}
              </div>
            )}
          </section>
        </aside>

        {/* Live-preview: den riktiga widgeten, Fraunces-scopad som publikt */}
        <main className="min-w-0 flex-1 bg-black/20 p-4">
          <div
            className={`h-full overflow-hidden rounded-2xl border border-[var(--w-line)] ${previewFontClass}`}
          >
            <BookingWidget
              key={preview.offerings.length > 0 ? "with-start" : "no-start"}
              embedded
              slug={slug}
              name={draft.name}
              openDays={preview.openDays}
              maxParty={initialConfig.escalationPartySize}
              menu={draft.menu}
              hoursDisplay={preview.hoursDisplay}
              offerings={preview.offerings}
              heroImageUrl={draft.heroImageUrl}
              logoUrl={draft.logoUrl}
            />
          </div>
        </main>
      </div>
    </div>
  );
}

function ImageUpload({
  slug,
  value,
  onChange,
  onError,
  compact = false,
}: {
  slug: string;
  value: string;
  onChange: (url: string) => void;
  onError: (msg: string | null) => void;
  compact?: boolean;
}) {
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleFile(file: File) {
    setUploading(true);
    onError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(`/api/restaurants/${slug}/upload`, {
        method: "POST",
        body: form,
      });
      const data = await res.json();
      if (!res.ok) {
        onError(data.error ?? "Uppladdningen misslyckades.");
        return;
      }
      onChange(data.url);
    } catch {
      onError("Uppladdningen misslyckades — prova igen.");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="flex items-center gap-3">
      {value ? (
        // eslint-disable-next-line @next/next/no-img-element -- Supabase Storage-URL, visas som miniatyr
        <img
          src={value}
          alt=""
          className={`${compact ? "h-10 w-16" : "h-14 w-24"} rounded-lg object-cover border border-[var(--w-line)]`}
        />
      ) : (
        <div
          className={`${compact ? "h-10 w-16" : "h-14 w-24"} rounded-lg border border-dashed border-[var(--w-line)]`}
        />
      )}
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
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
        className="h-9 rounded-lg border border-[var(--w-line)] px-3 text-xs text-[var(--w-muted)] hover:border-[var(--w-accent)] hover:text-[var(--w-ink)] disabled:opacity-50 transition"
      >
        {uploading ? "Laddar upp…" : value ? "Byt bild" : "Ladda upp bild"}
      </button>
      {value && (
        <button
          type="button"
          onClick={() => onChange("")}
          className="text-xs text-[var(--w-muted)] hover:text-[var(--w-ink)]"
        >
          Ta bort
        </button>
      )}
    </div>
  );
}
