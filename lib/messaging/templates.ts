// Utskicksmallarna (§3.7) — rena funktioner data → { subject, text } så att
// skarpa utskick och "Visa utskick"-previewn renderar IDENTISKT.
// Copyn kommer från design-POC:n (GPG Booking.dc.html) och parametriseras
// med restaurangens konfigurerade policyvärden (§2b) — aldrig hårdkodade 4/250.

export type MailPolicy = {
  cancellationWindowHours: number;
  noShowFeePerGuest: number;
  cardGuaranteeRequired: boolean;
};

export type BookingMailData = {
  restaurantName: string;
  guestName?: string | null;
  /** "måndag 16 juni kl 18:30" — bygg med formatBookingWhen. */
  whenText: string;
  partySize: number;
  tableName?: string | null;
  manageUrl: string;
  policy: MailPolicy;
};

export type RenderedMail = { subject: string; text: string };

export function formatBookingWhen(startsAt: Date, timezone: string): string {
  const datum = new Intl.DateTimeFormat("sv-SE", {
    timeZone: timezone,
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(startsAt);
  const tid = new Intl.DateTimeFormat("sv-SE", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
  }).format(startsAt);
  return `${datum} kl ${tid}`;
}

function firstName(name?: string | null): string {
  const first = (name ?? "").trim().split(/\s+/)[0];
  return first || "";
}

function greeting(name?: string | null): string {
  const first = firstName(name);
  return first ? `Hej ${first}!` : "Hej!";
}

/** Policyfoten i ALLA utskick (§3.7). Avgiftsraden utelämnas när kortgarantin är avslagen — avgift kan då aldrig debiteras. */
export function policyFooter(p: MailPolicy): string {
  const fri = `Avboka eller ändra kostnadsfritt fram till ${p.cancellationWindowHours} timmar före ankomst.`;
  if (!p.cardGuaranteeRequired) return fri;
  return `${fri} Vid utebliven ankomst debiteras ${p.noShowFeePerGuest} kr per gäst.`;
}

function guestsLabel(n: number): string {
  return `${n} ${n === 1 ? "gäst" : "gäster"}`;
}

// --- Mejlmallar ---

export function bekraftelseMail(d: BookingMailData): RenderedMail {
  return {
    subject: `Din bokning är bekräftad — ${d.restaurantName}`,
    text: [
      `${greeting(d.guestName)} Vi ser fram emot ert besök: ${guestsLabel(d.partySize)}, ${d.whenText}.`,
      `Behöver du ändra antal, lämna ett meddelande eller avboka? Använd länken nedan — det går kostnadsfritt fram till ${d.policy.cancellationWindowHours} timmar före ankomst.`,
      `Hantera din bokning: ${d.manageUrl}`,
      policyFooter(d.policy),
    ].join("\n\n"),
  };
}

export function kortlankMail(
  d: BookingMailData & { deadlineText: string },
): RenderedMail {
  return {
    subject: `Bekräfta din bokning med kort — ${d.restaurantName}`,
    text: [
      `${greeting(d.guestName)} Din bokning (${guestsLabel(d.partySize)}, ${d.whenText}) är preliminär.`,
      `Ange ett kort som garanti så bekräftas bokningen direkt. Inget dras nu — kortet debiteras endast vid utebliven ankomst (${d.policy.noShowFeePerGuest} kr per gäst).`,
      `Utan kortbekräftelse avbokas bokningen automatiskt ${d.deadlineText}.`,
      `Ange kort och bekräfta: ${d.manageUrl}`,
      policyFooter(d.policy),
    ].join("\n\n"),
  };
}

export function paminnelseMail(
  d: BookingMailData & { timeText: string },
): RenderedMail {
  return {
    subject: `Vi ses snart — imorgon kl ${d.timeText} — ${d.restaurantName}`,
    text: [
      `${greeting(d.guestName)} En påminnelse om er bokning: ${guestsLabel(d.partySize)}, ${d.whenText}.`,
      `Får ni förhinder? Avboka eller ändra via länken nedan så släpper vi bordet till någon annan.`,
      `Hantera din bokning: ${d.manageUrl}`,
      policyFooter(d.policy),
    ].join("\n\n"),
  };
}

/** Påminnelse-varianten för preliminära bokningar utan kort (§2 p.4). */
export function kortPaminnelseMail(
  d: BookingMailData & { deadlineText: string },
): RenderedMail {
  return {
    subject: `Din bokning väntar på kortbekräftelse — ${d.restaurantName}`,
    text: [
      `${greeting(d.guestName)} En påminnelse: din bokning (${guestsLabel(d.partySize)}, ${d.whenText}) är fortfarande preliminär.`,
      `Ange ett kort som garanti så bekräftas bokningen direkt — inget dras nu. Utan kortbekräftelse avbokas bokningen automatiskt ${d.deadlineText}.`,
      `Ange kort och bekräfta: ${d.manageUrl}`,
      policyFooter(d.policy),
    ].join("\n\n"),
  };
}

/**
 * Auto-avbokning. Medvetet neutral formulering ("inte bekräftades i tid",
 * inte "kortet saknades") — AI-inkorgens preliminära bokningar har inte
 * nödvändigtvis fått en kortlänk och får inte mötas av ett obegripligt mejl.
 */
export function autoAvbokningMail(
  d: BookingMailData & { rebookUrl: string },
): RenderedMail {
  return {
    subject: `Din bokning har avbokats — ${d.restaurantName}`,
    text: [
      `${greeting(d.guestName)} Din bokning (${guestsLabel(d.partySize)}, ${d.whenText}) har avbokats eftersom den inte bekräftades i tid. Ingen avgift debiteras.`,
      `Vill ni fortfarande komma? Ni är varmt välkomna att boka en ny tid: ${d.rebookUrl}`,
      policyFooter(d.policy),
    ].join("\n\n"),
  };
}

export function avbokningsbekraftelseMail(d: BookingMailData): RenderedMail {
  return {
    subject: `Din bokning är avbokad — ${d.restaurantName}`,
    text: [
      `${greeting(d.guestName)} Din bokning (${guestsLabel(d.partySize)}, ${d.whenText}) är nu avbokad. Ingen avgift debiteras och eventuell kortgaranti är släppt.`,
      `Ni är varmt välkomna åter.`,
      policyFooter(d.policy),
    ].join("\n\n"),
  };
}

export function andringsnotisMail(d: BookingMailData): RenderedMail {
  const bord = d.tableName ? ` · ${d.tableName}` : "";
  return {
    subject: `Din bokning är uppdaterad — ${d.restaurantName}`,
    text: [
      `${greeting(d.guestName)} Din bokning är ändrad. Nya uppgifter: ${guestsLabel(d.partySize)}, ${d.whenText}${bord}.`,
      `Stämmer inte något? Ändra eller avboka via länken nedan.`,
      `Hantera din bokning: ${d.manageUrl}`,
      policyFooter(d.policy),
    ].join("\n\n"),
  };
}

// --- SMS-varianter (korta enradare + länk) ---

export function bekraftelseSms(d: BookingMailData): string {
  return `${d.restaurantName}: Din bokning är bekräftad — ${guestsLabel(d.partySize)}, ${d.whenText}. Ändra/avboka: ${d.manageUrl}`;
}

export function kortlankSms(
  d: BookingMailData & { deadlineText: string },
): string {
  return `${d.restaurantName}: Din bokning är preliminär. Ange kort som garanti (inget dras nu) så bekräftas den — annars avbokas den automatiskt ${d.deadlineText}: ${d.manageUrl}`;
}

export function paminnelseSms(d: BookingMailData): string {
  return `${d.restaurantName}: Påminnelse — ${guestsLabel(d.partySize)}, ${d.whenText}. Förhinder? ${d.manageUrl}`;
}

export function autoAvbokningSms(d: BookingMailData): string {
  return `${d.restaurantName}: Din bokning ${d.whenText} har avbokats eftersom den inte bekräftades i tid. Ingen avgift debiteras.`;
}

export function avbokningSms(d: BookingMailData): string {
  return `${d.restaurantName}: Din bokning ${d.whenText} är avbokad. Ingen avgift debiteras — kortgarantin är släppt.`;
}

export function andringSms(d: BookingMailData): string {
  return `${d.restaurantName}: Din bokning är ändrad — ${guestsLabel(d.partySize)}, ${d.whenText}. Detaljer: ${d.manageUrl}`;
}
