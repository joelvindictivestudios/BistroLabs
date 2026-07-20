import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/client";
import { parseRestaurantConfig } from "@/lib/email-concierge/types";
import { createBooking } from "@/lib/booking/availability";
import { guestBookingBlocked } from "@/lib/booking/rules";
import { findOrCreateGuest } from "@/lib/booking/guests";
import { ALLERGY_CONSENT_TEXT } from "@/lib/booking/consent";
import { embed } from "@/lib/ai/embeddings";
import { setInteractionEmbedding } from "@/lib/db/vector";
import { notifyGuest, logCommunication } from "@/lib/messaging/notify";
import {
  bekraftelseMail,
  bekraftelseSms,
  formatBookingWhen,
} from "@/lib/messaging/templates";
import { buildManageUrl } from "@/lib/booking/manage-token";
import { appBaseUrl } from "@/lib/urls";

const bookRequestSchema = z
  .object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    time: z.string().regex(/^\d{2}:\d{2}$/),
    partySize: z.number().int().min(1),
    childrenCount: z.number().int().min(0).default(0),
    name: z.string().max(120).optional(),
    phone: z.string().min(5).max(30).optional(),
    email: z.email().optional(),
    notes: z.string().max(500).optional(),
    /** Hälsouppgift (GDPR art 9) — lagras i Booking.allergyNote, gallras vid COMPLETED */
    allergies: z.string().max(300).optional(),
    allergyConsent: z.boolean().optional(),
  })
  .refine((d) => d.email || d.phone, {
    message: "Ange e-post eller telefonnummer",
    path: ["email"],
  })
  .refine((d) => d.childrenCount <= d.partySize, {
    message: "Antal barn kan inte överstiga sällskapets storlek",
    path: ["childrenCount"],
  })
  .refine((d) => !d.allergies?.trim() || d.allergyConsent === true, {
    message:
      "Bekräfta samtycket för allergiuppgiften, eller lämna fältet tomt.",
    path: ["allergyConsent"],
  });

// POST /api/widget/demo/book → skapar CONFIRMED-bokning direkt (widgetflödet)
export async function POST(
  request: NextRequest,
  ctx: RouteContext<"/api/widget/[slug]/book">,
) {
  const { slug } = await ctx.params;
  const parsed = bookRequestSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      {
        error:
          parsed.error.issues[0]?.message ?? "Ogiltiga bokningsuppgifter",
        details: parsed.error.issues,
      },
      { status: 400 },
    );
  }
  const body = parsed.data;

  const restaurant = await prisma.restaurant.findUnique({ where: { slug } });
  if (!restaurant) {
    return NextResponse.json({ error: "Okänd restaurang" }, { status: 404 });
  }
  const config = parseRestaurantConfig(restaurant.config);

  // Gästspärrar: bokningsstopp-datum + same-day-cutoff
  const blockedReason = guestBookingBlocked(config, body.date);
  if (blockedReason) {
    return NextResponse.json({ error: blockedReason }, { status: 409 });
  }

  // Stora sällskap hanteras manuellt — samma tröskel som mejl-conciergen
  if (body.partySize > config.escalationPartySize) {
    return NextResponse.json(
      {
        error: `För sällskap över ${config.escalationPartySize} personer — mejla oss så ordnar vi det personligen.`,
        escalate: true,
      },
      { status: 422 },
    );
  }

  const { guest } = await findOrCreateGuest(restaurant.id, body);

  const result = await createBooking(
    restaurant.id,
    config,
    guest.id,
    body.date,
    body.time,
    body.partySize,
    body.notes,
    { status: "CONFIRMED", createdBy: "widget" },
  );
  if (!result.ok) {
    return NextResponse.json({ error: result.reason }, { status: 409 });
  }

  const allergies = body.allergies?.trim();
  if (body.childrenCount > 0 || allergies) {
    await prisma.booking.update({
      where: { id: result.bookingId },
      data: {
        childrenCount: body.childrenCount,
        ...(allergies
          ? {
              allergyNote: allergies,
              allergyConsentAt: new Date(),
              allergyConsentText: ALLERGY_CONSENT_TEXT,
            }
          : {}),
      },
    });
  }

  // Kommunikationslogg: bokningen mottagen (tidslinjen i bokningsdetaljen)
  await logCommunication(result.bookingId, "RECEIVED", null, {
    kalla: "widget",
  });

  // Bekräftelsemejl (mall 1, §3.7) med hanteringslänk + policyfot —
  // transaktionsutskick, kräver inget marknadsföringssamtycke.
  // Best-effort: ett mejlfel får aldrig fälla bokningen.
  const guestEmail = body.email ?? guest.email;
  if (guestEmail) {
    const endsAt = new Date(
      result.startsAt.getTime() + config.bookingDurationMinutes * 60_000,
    );
    const mailData = {
      restaurantName: restaurant.name,
      guestName: body.name ?? guest.name,
      whenText: formatBookingWhen(result.startsAt, config.timezone),
      partySize: body.partySize,
      tableName: result.tableName,
      manageUrl: buildManageUrl(
        appBaseUrl(request.nextUrl.origin),
        result.bookingId,
        endsAt,
      ),
      policy: {
        cancellationWindowHours: config.cancellationWindowHours,
        noShowFeePerGuest: config.noShowFeePerGuest,
        cardGuaranteeRequired: config.cardGuaranteeRequired,
      },
    };
    const { emailOk } = await notifyGuest({
      bookingId: result.bookingId,
      guest: { email: guestEmail, phone: body.phone ?? guest.phone },
      type: "CONFIRMATION",
      email: bekraftelseMail(mailData),
      sms: bekraftelseSms(mailData),
      smsFrom: config.voiceAgent.phoneNumber || undefined,
    });
    if (emailOk) {
      await prisma.booking.update({
        where: { id: result.bookingId },
        data: { confirmationSentAt: new Date() },
      });
    }
  }

  // Guest Intelligence: widgetbokningen blir en sökbar interaktion.
  // Embedding är best-effort — bokningen ska inte falla på ett OpenAI-fel.
  const summary =
    `Bokade via widgeten: ${body.partySize} personer` +
    (body.childrenCount > 0 ? ` (varav ${body.childrenCount} barn)` : "") +
    ` ${body.date} kl ${body.time}` +
    (body.notes ? `. Önskemål: ${body.notes}` : "");
  try {
    const interaction = await prisma.guestInteraction.create({
      data: {
        guestId: guest.id,
        type: "WIDGET",
        intent: "BOOKING_REQUEST",
        rawContent: summary,
        summary,
      },
    });
    await setInteractionEmbedding(interaction.id, await embed(summary));
    await prisma.guestProfile.upsert({
      where: { guestId: guest.id },
      update: {},
      create: { guestId: guest.id },
    });
  } catch (e) {
    console.error("Kunde inte spara widget-interaktion:", e);
  }

  return NextResponse.json({
    bookingId: result.bookingId,
    tableName: result.tableName,
    date: body.date,
    time: body.time,
    partySize: body.partySize,
    childrenCount: body.childrenCount,
  });
}
