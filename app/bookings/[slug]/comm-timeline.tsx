"use client";

import {
  cardDeadline,
  clockTime,
  formatKr,
  type Booking,
  type CommLogEntry,
  type PolicyConfig,
} from "./booking-types";

// Tidslinjen "Kommunikation" (§1): ifyllda punkter = faktiskt skickade
// utskick/händelser ur CommunicationLog; ihåliga = planerade (påminnelse,
// auto-avbokning) beräknade vid rendering — aldrig lagrade (§2b p.3).

const SOURCE_LABELS: Record<string, string> = {
  widget: "Online",
  concierge: "AI-mejl",
  dropin: "Personal",
  human: "Personal",
  personal: "Personal",
};

function channelLabel(c: CommLogEntry["channel"]): string {
  return c === "EMAIL" ? "mejl" : c === "SMS" ? "SMS" : "";
}

function entryLabel(e: CommLogEntry, booking: Booking): string {
  const kalla =
    (e.meta?.kalla as string | undefined) ?? booking.createdBy ?? "";
  switch (e.type) {
    case "RECEIVED":
      return `Bokning mottagen · ${SOURCE_LABELS[kalla] ?? "Online"}`;
    case "CARD_LINK":
      return "Kort- & hanteringslänk mejlad";
    case "CONFIRMATION":
      return `Bekräftelse + hanteringslänk · ${channelLabel(e.channel)}`;
    case "REMINDER":
      return `Påminnelse · ${channelLabel(e.channel)}`;
    case "AUTO_CANCELLATION":
      return "Auto-avbokning meddelad";
    case "FEE_CHARGED":
      return `No-show-avgift debiterad · ${formatKr(Number(e.meta?.belopp ?? 0))}`;
    case "CANCELLATION_CONFIRMATION":
      return "Avbokningsbekräftelse skickad";
    case "CHANGE":
      return `Ändring meddelad · ${channelLabel(e.channel)}`;
  }
}

function when(iso: string): string {
  const d = new Date(iso);
  return `${d.toLocaleDateString("sv-SE", { day: "numeric", month: "short" })} ${clockTime(d)}`;
}

export function CommTimeline({
  booking,
  policy,
  onPreviewMail,
}: {
  booking: Booking;
  policy: PolicyConfig;
  onPreviewMail: () => void;
}) {
  // Dedupe: samma typ+kanal kan loggas flera gånger (t.ex. omskickad
  // kortlänk) — visa varje förekomst, det ÄR historiken.
  const done = booking.commLog.map((e) => ({
    key: e.id,
    label: entryLabel(e, booking),
    when: when(e.at),
  }));

  const planned: { key: string; label: string; when: string }[] = [];
  if (booking.status === "PENDING") {
    planned.push(
      {
        key: "p-rem",
        label: "Påminnelse om kortbekräftelse",
        when: "24 tim före ankomst",
      },
      {
        key: "p-auto",
        label: "Auto-avbokning om kort saknas",
        when: `kl ${clockTime(cardDeadline(booking.startsAt, policy.cancellationWindowHours))}`,
      },
    );
  } else if (booking.status === "CONFIRMED" && !booking.commLog.some((e) => e.type === "REMINDER")) {
    planned.push({
      key: "p-rem",
      label: "Påminnelse",
      when: "24 tim före ankomst",
    });
  }

  return (
    <div className="mt-5">
      <div className="flex items-center justify-between">
        <span className="text-xs text-[var(--w-muted)]">Kommunikation</span>
        <button
          onClick={onPreviewMail}
          className="text-xs font-semibold text-[var(--w-accent)] hover:brightness-110 transition"
        >
          Visa utskick
        </button>
      </div>
      <div className="mt-2 space-y-1.5">
        {done.length === 0 && planned.length === 0 && (
          <p className="text-xs text-[var(--w-muted)]">
            Inga utskick loggade ännu.
          </p>
        )}
        {done.map((row) => (
          <div key={row.key} className="flex items-start gap-2.5">
            <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-[var(--w-accent)]" />
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium">{row.label}</p>
              <p className="text-[10px] text-[var(--w-muted)]">{row.when}</p>
            </div>
          </div>
        ))}
        {planned.map((row) => (
          <div key={row.key} className="flex items-start gap-2.5">
            <span className="mt-1 h-2 w-2 shrink-0 rounded-full border border-[var(--w-line)] bg-transparent" />
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium text-[var(--w-muted)]">
                {row.label}
              </p>
              <p className="text-[10px] text-[var(--w-muted)]">{row.when}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
