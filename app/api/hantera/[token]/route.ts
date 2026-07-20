import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/client";
import { parseRestaurantConfig } from "@/lib/email-concierge/types";
import { verifyManageToken, buildManageUrl } from "@/lib/booking/manage-token";
import {
  checkAvailability,
  isOverlapViolation,
} from "@/lib/booking/availability";
import { insideCancellationWindow } from "@/lib/booking/policy";
import { ALLERGY_CONSENT_TEXT } from "@/lib/booking/consent";
import { notifyGuest } from "@/lib/messaging/notify";
import {
  andringsnotisMail,
  formatBookingWhen,
} from "@/lib/messaging/templates";
import { appBaseUrl } from "@/lib/urls";

// PATCH /api/hantera/[token] — gästens egna ändringar via signerad länk (§3.6):
// omboka datum/tid, ändra antal, ange allergier, meddelande till restaurangen.
// Ingen inloggning — token ÄR auth (HMAC-signerad, se lib/booking/manage-token).
//
// Medvetet beslut: bookingStopDates/sameDayCutoff tillämpas INTE på ändring
// av befintlig bokning — spärrarna gäller nya gästbokningar (§3.6 nämner bara
// stängda dagar + fulla tider, vilka stoppas av availability-motorn).

const patchSchema = z
  .object({
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    time: z
      .string()
      .regex(/^\d{2}:\d{2}$/)
      .optional(),
    partySize: z.number().int().min(1).max(50).optional(),
    allergies: z.string().max(300).nullable().optional(),
    allergyConsent: z.boolean().optional(),
    message: z.string().max(500).optional(),
  })
  .refine((d) => Object.values(d).some((v) => v !== undefined), {
    message: "Minst en ändring krävs",
  })
  .refine((d) => (d.date === undefined) === (d.time === undefined), {
    message: "Datum och tid anges tillsammans",
    path: ["time"],
  })
  .refine(
    (d) => !d.allergies?.trim() || d.allergyConsent === true,
    {
      message: "Samtycke krävs för att spara allergiuppgifter",
      path: ["allergyConsent"],
    },
  );

export async function PATCH(
  request: NextRequest,
  ctx: RouteContext<"/api/hantera/[token]">,
) {
  const { token } = await ctx.params;
  const verified = verifyManageToken(token);
  if (!verified.ok) {
    return verified.reason === "utgangen"
      ? NextResponse.json(
          { error: "Länken har gått ut — kontakta restaurangen." },
          { status: 410 },
        )
      : NextResponse.json({ error: "Ogiltig länk." }, { status: 401 });
  }

  const parsed = patchSchema.safeParse(await request.json());
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return NextResponse.json(
      { error: first?.message ?? "Ogiltiga uppgifter" },
      { status: 400 },
    );
  }
  const body = parsed.data;

  const booking = await prisma.booking.findUnique({
    where: { id: verified.bookingId },
    include: { guest: true, restaurant: true, table: true },
  });
  if (!booking) {
    return NextResponse.json({ error: "Bokningen finns inte." }, { status: 410 });
  }
  if (booking.status !== "PENDING" && booking.status !== "CONFIRMED") {
    return NextResponse.json(
      { error: "Bokningen kan inte längre ändras via länken." },
      { status: 410 },
    );
  }

  const config = parseRestaurantConfig(booking.restaurant.config);
  if (insideCancellationWindow(booking.startsAt, config)) {
    return NextResponse.json(
      {
        error: `Så nära ankomst kan ändringar inte göras online — ring oss så hjälper vi dig.`,
        phone:
          config.voiceAgent.transferNumber ||
          config.voiceAgent.phoneNumber ||
          null,
      },
      { status: 403 },
    );
  }

  const newParty = body.partySize ?? booking.partySize;
  if (newParty > config.escalationPartySize) {
    return NextResponse.json(
      {
        error: `Sällskap över ${config.escalationPartySize} gäster hanteras manuellt — kontakta restaurangen.`,
      },
      { status: 422 },
    );
  }

  // Tid-/antalsändring → omallokering via greedy-motorn, egen bokning exkluderad
  const timeChanged = body.date !== undefined && body.time !== undefined;
  const partyChanged = newParty !== booking.partySize;
  let newStartsAt = booking.startsAt;
  let newEndsAt = booking.endsAt;
  let newTableId = booking.tableId;
  let newTableName = booking.table?.name ?? null;

  if (timeChanged || partyChanged) {
    // Fallback till nuvarande lokala datum/tid när bara antalet ändras
    const currentDate = new Intl.DateTimeFormat("sv-SE", {
      timeZone: config.timezone,
    }).format(booking.startsAt);
    const currentTime = new Intl.DateTimeFormat("sv-SE", {
      timeZone: config.timezone,
      hour: "2-digit",
      minute: "2-digit",
    }).format(booking.startsAt);
    const date = body.date ?? currentDate;
    const time = body.time ?? currentTime;

    const availability = await checkAvailability(
      booking.restaurantId,
      config,
      date,
      time,
      newParty,
      { excludeBookingId: booking.id },
    );
    if (!availability.available) {
      return NextResponse.json(
        { error: availability.reason },
        { status: 409 },
      );
    }
    newStartsAt = availability.startsAt;
    newEndsAt = availability.endsAt;
    newTableId = availability.table.id;
    newTableName = availability.table.name;
  }

  // Allergi (GDPR art 9) — samtyckeslogg enligt widgetens mönster
  const allergyData =
    body.allergies === undefined
      ? {}
      : body.allergies === null || !body.allergies.trim()
        ? { allergyNote: null }
        : {
            allergyNote: body.allergies.trim(),
            allergyConsentAt: new Date(),
            allergyConsentText: ALLERGY_CONSENT_TEXT,
          };

  const notesData = body.message?.trim()
    ? {
        notes:
          (booking.notes ? `${booking.notes}\n` : "") +
          `Gäst (hanteringssidan): ${body.message.trim()}`,
      }
    : {};

  try {
    await prisma.booking.update({
      where: { id: booking.id },
      data: {
        startsAt: newStartsAt,
        endsAt: newEndsAt,
        tableId: newTableId,
        partySize: newParty,
        ...allergyData,
        ...notesData,
      },
    });
  } catch (e) {
    if (isOverlapViolation(e)) {
      return NextResponse.json(
        { error: "Tiden hann bokas av någon annan — välj en annan tid." },
        { status: 409 },
      );
    }
    throw e;
  }

  const policy = {
    cancellationWindowHours: config.cancellationWindowHours,
    noShowFeePerGuest: config.noShowFeePerGuest,
    cardGuaranteeRequired: config.cardGuaranteeRequired,
  };
  await notifyGuest({
    bookingId: booking.id,
    guest: booking.guest,
    type: "CHANGE",
    email: andringsnotisMail({
      restaurantName: booking.restaurant.name,
      guestName: booking.guest.name,
      whenText: formatBookingWhen(newStartsAt, config.timezone),
      partySize: newParty,
      tableName: newTableName,
      manageUrl: buildManageUrl(
        appBaseUrl(request.nextUrl.origin),
        booking.id,
        newEndsAt,
      ),
      policy,
    }),
  });

  return NextResponse.json({
    ok: true,
    partySize: newParty,
    startsAt: newStartsAt.toISOString(),
    tableName: newTableName,
  });
}
