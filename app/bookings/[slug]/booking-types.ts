// Delade typer + hjälpare för dagvyn och dess dialoger/paneler.
// Booking speglar /day-payloaden (app/api/restaurants/[slug]/day/route.ts).

export type CancelInfo = {
  av: "personal" | "gäst" | "auto";
  orsak?: string;
  tidpunkt: string; // ISO-8601
};

export type CommLogEntry = {
  id: string;
  type:
    | "RECEIVED"
    | "CARD_LINK"
    | "CONFIRMATION"
    | "REMINDER"
    | "AUTO_CANCELLATION"
    | "FEE_CHARGED"
    | "CANCELLATION_CONFIRMATION"
    | "CHANGE";
  channel: "EMAIL" | "SMS" | null;
  at: string; // ISO-8601
  meta: Record<string, unknown> | null;
};

export type Booking = {
  id: string;
  tableId: string | null;
  guestId: string | null;
  startsAt: string;
  endsAt: string;
  partySize: number;
  childrenCount: number;
  status: string;
  seatedAt: string | null;
  createdAt: string;
  createdBy: string;
  notes: string | null;
  arrivedCount: number | null;
  staffNote: string | null;
  allergyNote: string | null;
  guestName: string;
  guestEmail: string | null;
  guestPhone: string | null;
  cardLast4: string | null;
  charged: number | null;
  cancelInfo: CancelInfo | null;
  commLog: CommLogEntry[];
};

export type WaitlistEntry = {
  id: string;
  name: string;
  phone: string;
  partySize: number;
  date: string;
  wishedFrom: string;
  wishedTo: string;
  status: "WAITING" | "OFFERED";
  offeredTime: string | null;
};

export type PolicyConfig = {
  noShowFeePerGuest: number;
  cancellationWindowHours: number;
  cardGuaranteeRequired: boolean;
};

export function formatKr(n: number): string {
  return `${n.toLocaleString("sv-SE")} kr`;
}

/** Auto-avbokningsdeadline = start − fönster. Beräknas alltid vid rendering,
 *  lagras aldrig (§2b p.3). */
export function cardDeadline(startsAt: string, windowHours: number): Date {
  return new Date(new Date(startsAt).getTime() - windowHours * 3600_000);
}

export function clockTime(d: Date): string {
  return d.toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit" });
}

/** Läsbar rad för avbokade bokningar ur cancelInfo (§1). */
export function cancelInfoText(
  ci: CancelInfo | null,
  windowHours: number,
): string {
  if (!ci) return "Bokningen är avbokad.";
  const when = clockTime(new Date(ci.tidpunkt));
  const orsak = ci.orsak ? ` ${ci.orsak}.` : "";
  switch (ci.av) {
    case "auto":
      return `Avbokades automatiskt kl ${when} — kortbekräftelse saknades vid tidsgränsen (${windowHours} tim före ankomst).`;
    case "gäst":
      return `Avbokad av gästen via hanteringslänken kl ${when}.${orsak}`;
    default:
      return `Avbokad av personal kl ${when}.${orsak}`;
  }
}
