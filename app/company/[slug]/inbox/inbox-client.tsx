"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

// AI-inkorgen (ÖVERLÄMNING punkt 8): lista med gästmejl + detaljpanel där
// personalen redigerar AI:ns utkast och godkänner ("Godkänn & skicka") eller
// tar över manuellt ("Jag tar den själv"). Inget skickas utan godkännande.

type Message = {
  id: string;
  direction: "INBOUND" | "OUTBOUND";
  status: "RECEIVED" | "DRAFT" | "SENT" | "ESCALATED";
  fromAddress: string;
  body: string;
  intent: string | null;
  confidence: number | null;
  escalated: boolean;
  escalationReason: string | null;
  handledAt: string | null;
  createdAt: string;
};

type Thread = {
  id: string;
  subject: string;
  guestName: string | null;
  guestEmail: string | null;
  createdAt: string;
  messages: Message[];
};

const INTENT_LABELS: Record<string, string> = {
  BOOKING_REQUEST: "Bokningsförfrågan",
  BOOKING_MODIFY: "Ändring av bokning",
  BOOKING_CANCEL: "Avbokning",
  QUESTION: "Fråga",
  COMPLAINT: "Klagomål",
  OTHER: "Övrigt",
};

type ItemState = "pending" | "escalated" | "sent" | "manual";

const STATE_PILLS: Record<ItemState, { label: string; classes: string }> = {
  pending: {
    label: "Utkast väntar",
    classes: "bg-status-booked-bg text-status-booked-fg",
  },
  escalated: {
    label: "Eskalerad",
    classes: "bg-status-late-bg text-status-late-fg",
  },
  sent: { label: "Skickat", classes: "bg-status-seated-bg text-status-seated-fg" },
  manual: {
    label: "Hanteras manuellt",
    classes: "bg-status-done-bg text-status-done-fg",
  },
};

type InboxItem = {
  thread: Thread;
  inbound: Message | null;
  outbound: Message;
  state: ItemState;
};

function itemState(outbound: Message): ItemState {
  if (outbound.status === "SENT") return "sent";
  if (outbound.handledAt) return "manual";
  if (outbound.status === "ESCALATED") return "escalated";
  return "pending";
}

export function InboxClient({ slug }: { slug: string }) {
  const [threads, setThreads] = useState<Thread[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null); // outbound-meddelandets id
  // Utkastbufferten är härledd: den gäller bara det meddelande den skrevs
  // för — vid byte av val faller vi tillbaka till meddelandets sparade text
  const [draftEdit, setDraftEdit] = useState<{ id: string; text: string } | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentFlash, setSentFlash] = useState<string | null>(null);

  const fetchInbox = useCallback(async () => {
    try {
      const res = await fetch(`/api/restaurants/${slug}/inbox`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? "Kunde inte hämta inkorgen.");
        return;
      }
      const data = (await res.json()) as { threads: Thread[] };
      setThreads(data.threads);
    } catch {
      setError("Kunde inte hämta inkorgen.");
    }
  }, [slug]);

  useEffect(() => {
    // Datahämtning vid mount — setState sker först efter await:erna
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchInbox();
  }, [fetchInbox]);

  const items: InboxItem[] = useMemo(() => {
    if (!threads) return [];
    return threads.flatMap((thread) => {
      const outbound = [...thread.messages]
        .reverse()
        .find((m) => m.direction === "OUTBOUND");
      if (!outbound) return [];
      const inbound =
        thread.messages.find((m) => m.direction === "INBOUND") ?? null;
      return [{ thread, inbound, outbound, state: itemState(outbound) }];
    });
  }, [threads]);

  const selected =
    items.find((i) => i.outbound.id === selectedId) ?? items[0] ?? null;

  const draft =
    draftEdit && draftEdit.id === selected?.outbound.id
      ? draftEdit.text
      : (selected?.outbound.body ?? "");
  const setDraft = (text: string) => {
    if (selected) setDraftEdit({ id: selected.outbound.id, text });
  };

  const timeFmt = (iso: string) =>
    new Date(iso).toLocaleString("sv-SE", {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });

  async function saveDraftIfChanged(item: InboxItem): Promise<boolean> {
    if (draft.trim() === item.outbound.body.trim()) return true;
    const res = await fetch(
      `/api/restaurants/${slug}/inbox/${item.outbound.id}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: draft.trim() }),
      },
    );
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "Kunde inte spara utkastet.");
      return false;
    }
    return true;
  }

  async function approveAndSend(item: InboxItem) {
    if (!draft.trim()) {
      setError("Skriv ett svar innan du skickar.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (!(await saveDraftIfChanged(item))) return;
      const res = await fetch(
        `/api/restaurants/${slug}/inbox/${item.outbound.id}/send`,
        { method: "POST" },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? "Mejlet kunde inte skickas — försök igen.");
        return;
      }
      setSentFlash(item.outbound.id);
      setTimeout(() => setSentFlash(null), 2500);
      await fetchInbox();
    } finally {
      setBusy(false);
    }
  }

  async function takeOver(item: InboxItem) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/restaurants/${slug}/inbox/${item.outbound.id}/claim`,
        { method: "POST" },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? "Kunde inte ta över meddelandet.");
        return;
      }
      await fetchInbox();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-5xl">
      <div className="mb-6">
        <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-ink-hint">
          AI-inkorg — gästmejl
        </p>
        <p className="mt-1.5 text-[13.5px] text-ink-faint">
          AI:n skriver utkast; inget skickas utan ditt godkännande.
        </p>
      </div>

      {error && (
        <p className="mb-4 rounded-lg border border-status-late-border bg-status-late-bg px-3 py-2 text-xs text-status-late-fg">
          {error}
        </p>
      )}

      {threads === null ? (
        <p className="text-sm text-ink-faint">Hämtar inkorgen…</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-ink-faint">
          Inga gästmejl ännu. När AI:n har skrivit ett utkast dyker det upp
          här för granskning.
        </p>
      ) : (
        <div className="grid items-start gap-5 lg:grid-cols-[1fr_1.3fr]">
          {/* Lista */}
          <div className="flex flex-col gap-2.5">
            {items.map((item) => {
              const pill = STATE_PILLS[item.state];
              const active = selected?.outbound.id === item.outbound.id;
              return (
                <button
                  key={item.outbound.id}
                  onClick={() => setSelectedId(item.outbound.id)}
                  className={`rounded-[14px] border-[1.5px] bg-card p-4 text-left shadow-soft transition-colors ${
                    active ? "border-accent" : "border-line-card hover:border-line-input"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-sm font-bold text-ink">
                      {item.thread.subject}
                    </span>
                    <span
                      className={`shrink-0 rounded-pill px-2.5 py-0.5 text-[11px] font-bold ${pill.classes}`}
                    >
                      {sentFlash === item.outbound.id ? "Skickat ✓" : pill.label}
                    </span>
                  </div>
                  <p className="mt-1 text-[12.5px] text-ink-faint">
                    {item.thread.guestName ??
                      item.inbound?.fromAddress ??
                      "Okänd avsändare"}{" "}
                    · {timeFmt(item.thread.createdAt)}
                  </p>
                  <p className="mt-1.5 text-xs font-bold text-ink-faint">
                    {INTENT_LABELS[item.outbound.intent ?? ""] ?? "Övrigt"}
                  </p>
                </button>
              );
            })}
          </div>

          {/* Detaljpanel */}
          {selected && (
            <div className="rounded-card border border-line-card bg-panel p-6 shadow-card">
              <p className="text-[15px] font-bold text-ink">
                {selected.thread.subject}
              </p>
              <p className="mt-0.5 text-[12.5px] text-ink-faint">
                {selected.thread.guestName ??
                  selected.inbound?.fromAddress ??
                  "Okänd avsändare"}{" "}
                · {timeFmt(selected.thread.createdAt)}
              </p>

              {selected.inbound && (
                <blockquote className="mt-4 whitespace-pre-wrap rounded-r-[10px] border-l-[3px] border-line-input bg-inset px-3.5 py-3 text-[13.5px] leading-relaxed text-ink-muted">
                  {selected.inbound.body}
                </blockquote>
              )}

              {selected.outbound.escalationReason && (
                <p className="mt-3 text-xs text-status-late-fg">
                  Eskalerad: {selected.outbound.escalationReason}
                </p>
              )}

              {selected.state === "sent" ? (
                <>
                  <p className="mb-2 mt-5 text-[11.5px] font-bold uppercase tracking-[0.08em] text-ink-faint">
                    Skickat svar
                  </p>
                  <p className="whitespace-pre-wrap rounded-[10px] border border-line-input bg-inset px-3.5 py-3 text-[13.5px] leading-relaxed text-ink">
                    {selected.outbound.body}
                  </p>
                </>
              ) : (
                <>
                  <p className="mb-2 mt-5 text-[11.5px] font-bold uppercase tracking-[0.08em] text-ink-faint">
                    AI:ns utkast — redigera fritt
                  </p>
                  <textarea
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onBlur={() => void saveDraftIfChanged(selected)}
                    rows={6}
                    maxLength={5000}
                    placeholder={
                      selected.state === "escalated"
                        ? "AI:n lämnade den här till dig — skriv svaret själv…"
                        : undefined
                    }
                    className="w-full resize-none rounded-btn border border-line-input bg-inset px-3.5 py-3 text-[13.5px] leading-relaxed text-ink outline-none focus:border-accent"
                  />
                  <div className="mt-3.5 flex gap-2.5">
                    <button
                      onClick={() => void approveAndSend(selected)}
                      disabled={busy}
                      className="min-h-11 flex-[1.4] rounded-btn bg-accent text-[13.5px] font-bold text-accent-on shadow-accent hover:brightness-110 disabled:opacity-60 transition"
                    >
                      {busy ? "Skickar…" : "Godkänn & skicka"}
                    </button>
                    {selected.state !== "manual" && (
                      <button
                        onClick={() => void takeOver(selected)}
                        disabled={busy}
                        className="min-h-11 flex-1 rounded-btn border border-line-input text-[13.5px] font-semibold text-ink-muted hover:text-ink disabled:opacity-60 transition"
                      >
                        Jag tar den själv
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
