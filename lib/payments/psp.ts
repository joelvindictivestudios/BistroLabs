import { randomUUID } from "crypto";

// PSP-lager för kortgarantin — DEV-STUB tills skarp PSP kopplas (§4).
// Samma filosofi som sendEmail: körbart utan nycklar, kastar aldrig.
//
// PCI DSS: kortnummer/CVC lever endast i request-body → registerCard → glöms.
// Endast pspToken + last4 persisteras. Logga ALDRIG hela kortnumret eller CVC.
//
// Skarp Stripe senare: tokenisera klient-side (Elements/SetupIntent) så PAN
// aldrig rör servern — kort-endpointens zod får då en union
// ({ number… } | { pspToken }). Bygg inget mer för det nu.

export type RegisterCardInput = {
  number: string;
  expMonth: number;
  expYear: number;
  cvc: string;
};

export type RegisterCardResult =
  | { ok: true; pspToken: string; last4: string }
  | { ok: false; error: string };

export async function registerCard(
  input: RegisterCardInput,
): Promise<RegisterCardResult> {
  const digits = input.number.replace(/\D/g, "");
  if (digits.length < 12 || digits.length > 19) {
    return { ok: false, error: "Ogiltigt kortnummer." };
  }
  if (!/^\d{3,4}$/.test(input.cvc)) {
    return { ok: false, error: "Ogiltig CVC." };
  }
  if (
    !Number.isInteger(input.expMonth) ||
    input.expMonth < 1 ||
    input.expMonth > 12
  ) {
    return { ok: false, error: "Ogiltig giltighetsmånad." };
  }
  // Tvåsiffrigt år tolkas som 20XX
  const year = input.expYear < 100 ? 2000 + input.expYear : input.expYear;
  const now = new Date();
  if (
    year < now.getFullYear() ||
    (year === now.getFullYear() && input.expMonth < now.getMonth() + 1)
  ) {
    return { ok: false, error: "Kortets giltighetstid har gått ut." };
  }
  const last4 = digits.slice(-4);
  const pspToken = `stub_tok_${randomUUID()}`;
  console.log(`[dev-psp] kort registrerat •••• ${last4}`);
  return { ok: true, pspToken, last4 };
}

export type ChargeResult =
  | { ok: true; chargeId: string }
  | { ok: false; error: string };

/** Merchant-initiated debitering av no-show-avgiften mot registrerat kort. */
export async function chargeNoShowFee(
  pspToken: string,
  amountKr: number,
  bookingId: string,
): Promise<ChargeResult> {
  if (!pspToken.startsWith("stub_tok_")) {
    return { ok: false, error: "Okänd kortreferens." };
  }
  console.log(`[dev-psp] debiterar ${amountKr} kr (bokning ${bookingId})`);
  return { ok: true, chargeId: `stub_charge_${randomUUID()}` };
}

/** Släpper kortgarantin (avbokning/gallring). Best-effort — kastar aldrig. */
export async function releaseCard(
  pspToken: string,
): Promise<{ ok: boolean }> {
  console.log(`[dev-psp] kortgaranti släppt (${pspToken.slice(0, 16)}…)`);
  return { ok: true };
}
