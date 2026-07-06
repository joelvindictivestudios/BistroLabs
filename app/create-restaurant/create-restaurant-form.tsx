"use client";

import { useMemo, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { getBrowserSupabase } from "@/lib/auth/client";

// Minimal onboarding: namn + slug. Restaurangen skapas opublicerad med
// vettiga defaults (bord, öppettider, en sittning) och allt annat ställs
// in i editorn, dit man skickas direkt.

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[åä]/g, "a")
    .replace(/ö/g, "o")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 40);
}

export function CreateRestaurantForm({
  userEmail,
  defaultRestaurantName,
}: {
  userEmail: string;
  defaultRestaurantName: string;
}) {
  const router = useRouter();
  const [name, setName] = useState(defaultRestaurantName);
  const [slugTouched, setSlugTouched] = useState(false);
  const [slug, setSlug] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
        body: JSON.stringify({ name, slug: effectiveSlug, email: userEmail }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Kunde inte skapa restaurangen — prova igen.");
        return;
      }
      router.push(`/dashboard/${data.slug}`);
    } catch {
      setError("Något gick fel — prova igen.");
    } finally {
      setSubmitting(false);
    }
  }

  const inputClass =
    "w-full bg-transparent border-b border-[var(--w-line)] py-2.5 text-sm placeholder:text-[var(--w-muted)]/60 focus:border-[var(--w-accent)] focus:outline-none";

  return (
    <div
      className="relative min-h-dvh flex items-center justify-center bg-[var(--w-bg)] text-[var(--w-ink)] px-6"
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
      <Image
        src="/pexels-steve-29708309.jpg"
        alt=""
        fill
        priority
        sizes="100vw"
        className="object-cover"
      />
      <div className="absolute inset-0 bg-[linear-gradient(to_bottom,rgba(16,19,18,0.55),rgba(16,19,18,0.8))]" />

      <div className="relative z-10 w-full max-w-md">
        <Image
          src="/BLSideBySideLogo.png"
          alt="BistroLabs"
          width={160}
          height={79}
          priority
          className="mx-auto mb-6"
        />
        <div className="rounded-2xl border border-[var(--w-line)]/80 bg-[rgba(16,19,18,0.72)] p-8 backdrop-blur-md">
          <div className="flex items-start justify-between">
            <h1 className="text-2xl [font-family:var(--font-display),sans-serif] font-semibold tracking-tight">
              Skapa din restaurang
            </h1>
            <button
              type="button"
              onClick={async () => {
                await getBrowserSupabase().auth.signOut();
                router.push("/login");
                router.refresh();
              }}
              className="text-xs text-[var(--w-muted)] hover:text-[var(--w-ink)] transition-colors"
              title={userEmail}
            >
              Logga ut
            </button>
          </div>
          <p className="mt-2 text-sm text-[var(--w-muted)]">
            Bara namnet behövs — resten ställer du in i editorn.
          </p>

          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            <input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Restaurangens namn"
              className={inputClass}
            />
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

            {error && <p className="text-sm text-[var(--w-accent)]">{error}</p>}

            <button
              type="submit"
              disabled={submitting || !name || !effectiveSlug}
              className="w-full h-12 rounded-xl bg-[var(--w-accent)] text-[#141210] text-sm font-semibold tracking-wide shadow-lg shadow-black/25 hover:brightness-110 disabled:opacity-60 transition"
            >
              {submitting ? "Skapar…" : "Skapa & öppna editorn"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
