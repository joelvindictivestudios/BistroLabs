import { createHmac, timingSafeEqual } from "crypto";

// Signerad hanteringslänk (§2 p.5): gästen ändrar/avbokar utan konto.
// Token = `${bookingId}.${exp}.${base64url(HMAC-SHA256(`${bookingId}.${exp}`))}`
// — UUID + epoch-sekunder + base64url är URL-säkert rakt av.
// Tokens mintas per utskick; ombokning ger nya mejl med nya tokens.

const VALIDITY_AFTER_END_DAYS = 7;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function secret(): string {
  const s = process.env.BOOKING_LINK_SECRET;
  if (s) return s;
  if (process.env.NODE_ENV === "production") {
    throw new Error("BOOKING_LINK_SECRET saknas i produktion.");
  }
  console.warn(
    "[manage-token] BOOKING_LINK_SECRET saknas — använder dev-secret.",
  );
  return "dev-secret-ej-for-produktion";
}

function sign(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

export function createManageToken(bookingId: string, endsAt: Date): string {
  const exp = Math.floor(
    (endsAt.getTime() + VALIDITY_AFTER_END_DAYS * 864e5) / 1000,
  );
  const payload = `${bookingId}.${exp}`;
  return `${payload}.${sign(payload)}`;
}

export type VerifyResult =
  | { ok: true; bookingId: string }
  | { ok: false; reason: "format" | "signatur" | "utgangen" };

export function verifyManageToken(token: string): VerifyResult {
  const parts = token.split(".");
  if (parts.length !== 3) return { ok: false, reason: "format" };
  const [bookingId, expStr, sig] = parts;
  if (!UUID_RE.test(bookingId) || !/^\d+$/.test(expStr)) {
    return { ok: false, reason: "format" };
  }
  // Signaturen kontrolleras FÖRE utgången — läck inte giltighetsinfo för
  // förfalskade tokens.
  const expected = sign(`${bookingId}.${expStr}`);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, reason: "signatur" };
  }
  if (Number(expStr) * 1000 < Date.now()) {
    return { ok: false, reason: "utgangen" };
  }
  return { ok: true, bookingId };
}

export function buildManageUrl(
  baseUrl: string,
  bookingId: string,
  endsAt: Date,
): string {
  return `${baseUrl}/hantera/${createManageToken(bookingId, endsAt)}`;
}
