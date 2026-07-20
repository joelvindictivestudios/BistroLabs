import { prisma } from "@/lib/db/client";
import { parseRestaurantConfig } from "@/lib/email-concierge/types";
import {
  cancellationDeadline,
  formatDeadlineTime,
} from "@/lib/booking/policy";
import { buildManageUrl } from "@/lib/booking/manage-token";
import { appBaseUrl } from "@/lib/urls";
import { notifyGuest } from "@/lib/messaging/notify";
import {
  kortlankMail,
  kortlankSms,
  formatBookingWhen,
} from "@/lib/messaging/templates";

// Kortlänksutskicket (§3.2, §3.3, mall 2 i §3.7): mejlas när en preliminär
// bokning skapas, vid "Skicka kortlänken igen" och vid återaktivering till
// PENDING. Deadline beräknas vid varje utskick — lagras aldrig (§2b p.3).

export type SendCardLinkResult =
  | { ok: true }
  | { ok: false; error: string };

export async function sendCardLink(
  bookingId: string,
  origin?: string,
  opts?: { includeSms?: boolean; smsFrom?: string },
): Promise<SendCardLinkResult> {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: { guest: true, restaurant: true },
  });
  if (!booking) return { ok: false, error: "Okänd bokning." };
  if (booking.status !== "PENDING") {
    return { ok: false, error: "Bokningen är inte preliminär." };
  }
  if (!booking.guest.email) {
    return {
      ok: false,
      error: "Gästen saknar e-post — kortlänken kan inte mejlas.",
    };
  }

  const config = parseRestaurantConfig(booking.restaurant.config);
  const deadlineText = `kl ${formatDeadlineTime(
    cancellationDeadline(booking.startsAt, config),
    config.timezone,
  )}`;
  const data = {
    restaurantName: booking.restaurant.name,
    guestName: booking.guest.name,
    whenText: formatBookingWhen(booking.startsAt, config.timezone),
    partySize: booking.partySize,
    manageUrl: buildManageUrl(appBaseUrl(origin), booking.id, booking.endsAt),
    policy: {
      cancellationWindowHours: config.cancellationWindowHours,
      noShowFeePerGuest: config.noShowFeePerGuest,
      cardGuaranteeRequired: config.cardGuaranteeRequired,
    },
    deadlineText,
  };

  const { emailOk } = await notifyGuest({
    bookingId: booking.id,
    guest: booking.guest,
    type: "CARD_LINK",
    email: kortlankMail(data),
    ...(opts?.includeSms
      ? {
          sms: kortlankSms(data),
          smsFrom: opts.smsFrom ?? (config.voiceAgent.phoneNumber || undefined),
        }
      : {}),
  });
  return emailOk
    ? { ok: true }
    : { ok: false, error: "Kortlänken kunde inte mejlas — försök igen." };
}
