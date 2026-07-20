import { prisma } from "@/lib/db/client";
import { sendEmail } from "@/lib/messaging/send";
import type { RenderedMail } from "@/lib/messaging/templates";
import type {
  CommChannel,
  CommLogType,
} from "@/lib/generated/prisma/enums";

// Gästnotiser + kommunikationslogg (§1, §2 p.6).
// Loggrad skrivs ENDAST vid lyckat utskick — tidslinjen ska visa vad som
// faktiskt gick ut. Systemhändelser (RECEIVED, FEE_CHARGED) loggas med
// channel null via logCommunication direkt. Ingen funktion här kastar —
// notiser får aldrig fälla bokningsflödet.

/** Skalära meta-värden (Prisma Json-input) — t.ex. { belopp: 500, chargeId } */
export type CommLogMeta = Record<string, string | number | boolean | null>;

export async function logCommunication(
  bookingId: string,
  type: CommLogType,
  channel: CommChannel | null,
  meta?: CommLogMeta,
): Promise<void> {
  try {
    await prisma.communicationLog.create({
      data: {
        bookingId,
        type,
        channel,
        ...(meta ? { meta } : {}),
      },
    });
  } catch (e) {
    console.error("[notify] kunde inte skriva kommunikationslogg:", e);
  }
}

export type NotifyGuestInput = {
  bookingId: string;
  guest: { email?: string | null; phone?: string | null };
  /** Loggtyp för båda kanalerna. */
  type: CommLogType;
  /** Skickas om guest.email finns. */
  email?: RenderedMail;
  /** Skickas om guest.phone finns (kopplas på i etapp 7 — SMS). */
  sms?: string;
  smsFrom?: string;
  meta?: CommLogMeta;
};

export async function notifyGuest(
  input: NotifyGuestInput,
): Promise<{ emailOk: boolean; smsOk: boolean }> {
  let emailOk = false;
  let smsOk = false;

  if (input.email && input.guest.email) {
    try {
      const res = await sendEmail({
        to: input.guest.email,
        subject: input.email.subject,
        text: input.email.text,
      });
      if (res.ok) {
        emailOk = true;
        await logCommunication(input.bookingId, input.type, "EMAIL", {
          till: input.guest.email,
          ...input.meta,
        });
      }
    } catch (e) {
      console.error("[notify] mejl misslyckades:", e);
    }
  }

  if (input.sms && input.guest.phone) {
    try {
      // Lazy import — sms-modulen kommer i etapp 7; fältet lämnas oanvänt tills dess
      const { sendSms } = await import("@/lib/messaging/sms");
      const res = await sendSms({
        to: input.guest.phone,
        text: input.sms,
        from: input.smsFrom,
      });
      if (res.ok) {
        smsOk = true;
        await logCommunication(input.bookingId, input.type, "SMS", {
          till: input.guest.phone,
          ...input.meta,
        });
      }
    } catch (e) {
      console.error("[notify] SMS misslyckades:", e);
    }
  }

  return { emailOk, smsOk };
}
