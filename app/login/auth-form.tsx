"use client";

import { useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { getBrowserSupabase } from "@/lib/auth/client";

type Mode = "signin" | "signup";

export function AuthForm() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("signin");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function handleSignin(form: FormData) {
    const supabase = getBrowserSupabase();
    const { error } = await supabase.auth.signInWithPassword({
      email: String(form.get("email") ?? ""),
      password: String(form.get("password") ?? ""),
    });
    if (error) {
      setError(
        error.message === "Invalid login credentials"
          ? "Fel e-post eller lösenord."
          : error.message,
      );
      return;
    }
    router.push("/create-restaurant");
    router.refresh();
  }

  async function handleSignup(form: FormData) {
    const password = String(form.get("password") ?? "");
    const passwordConfirm = String(form.get("passwordConfirm") ?? "");
    if (password !== passwordConfirm) {
      setError("Lösenorden matchar inte.");
      return;
    }
    const res = await fetch("/api/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        restaurantName: String(form.get("restaurantName") ?? ""),
        name: String(form.get("name") ?? ""),
        email: String(form.get("email") ?? ""),
        password,
        passwordConfirm,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? "Kontot kunde inte skapas — prova igen.");
      return;
    }
    setMode("signin");
    setNotice("Kontot är skapat — logga in nedan.");
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setSubmitting(true);
    setError(null);
    setNotice(null);
    try {
      if (mode === "signin") await handleSignin(form);
      else await handleSignup(form);
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
        <h1 className="text-3xl [font-family:var(--font-display),sans-serif] font-semibold tracking-tight">
          {mode === "signin" ? "Välkommen tillbaka" : "Skapa ditt konto"}
        </h1>

        <div
          role="tablist"
          className="mt-6 grid grid-cols-2 rounded-xl border border-[var(--w-line)] p-1 text-sm"
        >
          {(
            [
              ["signin", "Logga in"],
              ["signup", "Skapa konto"],
            ] as const
          ).map(([m, label]) => (
            <button
              key={m}
              role="tab"
              aria-selected={mode === m}
              onClick={() => {
                setMode(m);
                setError(null);
                setNotice(null);
              }}
              className={`h-10 rounded-lg transition-colors motion-safe:duration-150 ${
                mode === m
                  ? "bg-[var(--w-panel)] text-[var(--w-accent)]"
                  : "text-[var(--w-muted)] hover:text-[var(--w-ink)]"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <form onSubmit={handleSubmit} className="mt-8 space-y-4">
          {mode === "signup" && (
            <>
              <input
                name="restaurantName"
                required
                placeholder="Restaurangens namn"
                className={inputClass}
              />
              <input
                name="name"
                required
                placeholder="Ditt namn"
                autoComplete="name"
                className={inputClass}
              />
            </>
          )}
          <input
            name="email"
            type="email"
            required
            placeholder="E-post"
            autoComplete="email"
            className={inputClass}
          />
          <input
            name="password"
            type="password"
            required
            minLength={8}
            placeholder={mode === "signup" ? "Lösenord (minst 8 tecken)" : "Lösenord"}
            autoComplete={mode === "signup" ? "new-password" : "current-password"}
            className={inputClass}
          />
          {mode === "signup" && (
            <input
              name="passwordConfirm"
              type="password"
              required
              minLength={8}
              placeholder="Upprepa lösenordet"
              autoComplete="new-password"
              className={inputClass}
            />
          )}

          {error && <p className="text-sm text-[var(--w-accent)]">{error}</p>}
          {notice && <p className="text-sm text-[var(--w-muted)]">{notice}</p>}

          <button
            type="submit"
            disabled={submitting}
            className="w-full h-12 rounded-xl bg-[var(--w-accent)] text-[#141210] text-sm font-semibold tracking-wide shadow-lg shadow-black/25 hover:brightness-110 disabled:opacity-60 transition motion-safe:duration-150"
          >
            {submitting
              ? "Vänta…"
              : mode === "signin"
                ? "Logga in"
                : "Skapa konto"}
          </button>
        </form>
        </div>
      </div>
    </div>
  );
}
