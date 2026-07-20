import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/client";
import { parseRestaurantConfig } from "@/lib/email-concierge/types";
import { verifyManageToken, buildManageUrl } from "@/lib/booking/manage-token";
import { registerCard } from "@/lib/payments/psp";
import { notifyGuest } from "@/lib/messaging/notify";
import {
  bekraftelseMail,
  formatBookingWhen,
} from "@/lib/messaging/templates";
import { appBaseUrl } from "@/lib/urls";

// POST /api/hantera/[token]/kort — gästen registrerar kort som garanti (§3.1
// kortsteget via länken): inget dras, bokningen auto-bekräftas (§2 p.2).
// Race-säkert mot auto-avbokningscronen: villkorad updateMany på status
// PENDING — förloraren får 410.

const cardSchema = z.object({
  number: z.string().min(12).max(30),
  expMonth: z.number().int().min(1).max(12),
  expYear: z.number().int().min(0).max(2100),
  cvc: z.string().regex(/^\d{3,4}$/),
});

export async function POST(
  request: NextRequest,
  ctx: RouteContext<"/api/hantera/[token]/kort">,
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

  const parsed = cardSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Kontrollera kortuppgifterna." },
      { status: 400 },
    );
  }

  const booking = await prisma.booking.findUnique({
    where: { id: verified.bookingId },
    include: { guest: true, restaurant: true },
  });
  if (!booking) {
    return NextResponse.json({ error: "Bokningen finns inte." }, { status: 410 });
  }
  if (booking.status === "CONFIRMED") {
    return NextResponse.json(
      { error: "Bokningen är redan bekräftad." },
      { status: 409 },
    );
  }
  if (booking.status !== "PENDING") {
    return NextResponse.json(
      { error: "Bokningen hann avbokas — kontakta restaurangen så hjälper vi dig." },
      { status: 410 },
    );
  }

  const card = await registerCard(parsed.data);
  if (!card.ok) {
    return NextResponse.json({ error: card.error }, { status: 400 });
  }

  // Villkorad skrivning — kortregistrering och auto-avbokning kan inte båda vinna
  const res = await prisma.booking.updateMany({
    where: { id: booking.id, status: "PENDING" },
    data: {
      cardPspToken: card.pspToken,
      cardLast4: card.last4,
      status: "CONFIRMED",
    },
  });
  if (res.count === 0) {
    return NextResponse.json(
      { error: "Bokningen hann avbokas — kontakta restaurangen så hjälper vi dig." },
      { status: 410 },
    );
  }

  // Bekräftelsen (mall 1) — engångs via confirmationSentAt, samma gate som
  // personalens Bekräfta-knapp
  const config = parseRestaurantConfig(booking.restaurant.config);
  if (booking.guest.email && !booking.confirmationSentAt) {
    const { emailOk } = await notifyGuest({
      bookingId: booking.id,
      guest: booking.guest,
      type: "CONFIRMATION",
      email: bekraftelseMail({
        restaurantName: booking.restaurant.name,
        guestName: booking.guest.name,
        whenText: formatBookingWhen(booking.startsAt, config.timezone),
        partySize: booking.partySize,
        manageUrl: buildManageUrl(
          appBaseUrl(request.nextUrl.origin),
          booking.id,
          booking.endsAt,
        ),
        policy: {
          cancellationWindowHours: config.cancellationWindowHours,
          noShowFeePerGuest: config.noShowFeePerGuest,
          cardGuaranteeRequired: config.cardGuaranteeRequired,
        },
      }),
    });
    if (emailOk) {
      await prisma.booking.update({
        where: { id: booking.id },
        data: { confirmationSentAt: new Date() },
      });
    }
  }

  return NextResponse.json({ ok: true, cardLast4: card.last4 });
}
