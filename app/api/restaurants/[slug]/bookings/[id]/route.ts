import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/client";
import { getUser } from "@/lib/auth/server";
import {
  isOverlapViolation,
  withinOpeningHours,
} from "@/lib/booking/availability";
import { parseRestaurantConfig } from "@/lib/email-concierge/types";
import { sendEmail } from "@/lib/messaging/send";
import { Prisma } from "@/lib/generated/prisma/client";
import { sendCardLink } from "@/lib/messaging/card-link";

const patchSchema = z
  .object({
    tableId: z.uuid().optional(),
    status: z
      .enum(["CONFIRMED", "SEATED", "COMPLETED", "NO_SHOW", "CANCELLED"])
      .optional(),
    guestId: z.uuid().optional(), // koppla drop-in till en riktig kund
    arrivedCount: z.number().int().min(0).max(50).optional(),
    staffNote: z.string().max(500).nullable().optional(),
    /** Valfri orsak vid avbokning — loggas i cancelInfo (§1). */
    cancelReason: z.string().max(200).optional(),
    /** Återaktivera avbokad bokning (§3.5): → CONFIRMED om kort finns, annars PENDING. */
    reactivate: z.boolean().optional(),
    // Tidsändring: date+time (lokal restaurangtid); endTime valfri —
    // annars start + bookingDurationMinutes
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    time: z.string().regex(/^\d{2}:\d{2}$/).optional(),
    endTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  })
  .refine((d) => Object.values(d).some((v) => v !== undefined), {
    message: "Ingen ändring angiven.",
  })
  .refine((d) => (d.date === undefined) === (d.time === undefined), {
    message: "Ange både date och time för att flytta bokningen.",
  })
  .refine((d) => d.endTime === undefined || d.time !== undefined, {
    message: "endTime kräver time.",
  })
  .refine((d) => d.cancelReason === undefined || d.status === "CANCELLED", {
    message: "cancelReason kräver status CANCELLED.",
  })
  .refine((d) => !d.reactivate || d.status === undefined, {
    message: "reactivate kombineras inte med status — målstatus avgörs av kortet.",
  });

// PATCH /api/restaurants/{slug}/bookings/{id} — personalens verktyg i dagvyn:
// flytta bokning (bord eller tid), ändra status (bekräfta, check-in, avsluta,
// släpp bordet, avboka), justera antal anlända och personalanteckning.
export async function PATCH(
  request: NextRequest,
  ctx: RouteContext<"/api/restaurants/[slug]/bookings/[id]">,
) {
  const user = await getUser();
  if (!user) {
    return NextResponse.json({ error: "Inte inloggad." }, { status: 401 });
  }
  const { slug, id } = await ctx.params;
  const restaurant = await prisma.restaurant.findUnique({ where: { slug } });
  if (!restaurant) {
    return NextResponse.json({ error: "Okänd restaurang." }, { status: 404 });
  }
  if (restaurant.ownerId !== user.id) {
    return NextResponse.json(
      { error: "Du äger inte den här restaurangen." },
      { status: 403 },
    );
  }

  const booking = await prisma.booking.findFirst({
    where: { id, restaurantId: restaurant.id },
    include: { guest: { select: { name: true, email: true } } },
  });
  if (!booking) {
    return NextResponse.json({ error: "Okänd bokning." }, { status: 404 });
  }

  const parsed = patchSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Ogiltig ändring." },
      { status: 400 },
    );
  }
  const {
    tableId,
    status: requestedStatus,
    guestId,
    arrivedCount,
    staffNote,
    cancelReason,
    reactivate,
    date,
    time,
    endTime,
  } = parsed.data;

  // Återaktivering (§3.5): endast från CANCELLED; kort kvar → CONFIRMED,
  // annars PENDING (kortlänken skickas på nytt nedan). Bordet kan ha hunnit
  // bokas — exclusion-constrainten ger 409 med flytta-först-instruktion.
  if (reactivate && booking.status !== "CANCELLED") {
    return NextResponse.json(
      { error: "Endast avbokade bokningar kan återaktiveras." },
      { status: 400 },
    );
  }
  const status = reactivate
    ? booking.cardPspToken
      ? ("CONFIRMED" as const)
      : ("PENDING" as const)
    : requestedStatus;

  if (guestId !== undefined) {
    const guest = await prisma.guest.findFirst({
      where: { id: guestId, restaurantId: restaurant.id },
    });
    if (!guest) {
      return NextResponse.json({ error: "Okänd kund." }, { status: 404 });
    }
  }

  // Flytt: kapacitet är ett hårt krav (fysiskt), minSeats ignoreras — personalen
  // vet bäst när de möblerar om. Tidskrockar stoppas av bookings_no_overlap.
  if (tableId !== undefined) {
    const table = await prisma.diningTable.findFirst({
      where: { id: tableId, restaurantId: restaurant.id },
    });
    if (!table) {
      return NextResponse.json({ error: "Okänt bord." }, { status: 404 });
    }
    if (table.capacity < booking.partySize) {
      return NextResponse.json(
        {
          error: `${table.name} rymmer bara ${table.capacity} — sällskapet är ${booking.partySize}.`,
        },
        { status: 400 },
      );
    }
  }

  // Tidsändring: personal får förbi gästspärrar (bokningsstopp/cutoff) men
  // inte röda dagar eller öppettider — samma regel som drop-in-POST.
  let newTimes: { startsAt: Date; endsAt: Date } | null = null;
  if (date !== undefined && time !== undefined) {
    const config = parseRestaurantConfig(restaurant.config);
    const hours = withinOpeningHours(config, date, time, endTime);
    if (!hours.ok) {
      return NextResponse.json({ error: hours.reason }, { status: 400 });
    }
    newTimes = { startsAt: hours.startsAt, endsAt: hours.endsAt };
  }

  const completing = status === "COMPLETED" && booking.status !== "COMPLETED";

  try {
    const data = {
      ...(tableId !== undefined ? { tableId } : {}),
      ...(status !== undefined ? { status } : {}),
      ...(guestId !== undefined ? { guestId } : {}),
      ...(newTimes ? { startsAt: newTimes.startsAt, endsAt: newTimes.endsAt } : {}),
      ...(staffNote !== undefined ? { staffNote: staffNote?.trim() || null } : {}),
      // Incheckning: stämpla tid + default anlända = bokat antal (justerbart)
      ...(status === "SEATED"
        ? {
            seatedAt: new Date(),
            arrivedCount: arrivedCount ?? booking.arrivedCount ?? booking.partySize,
          }
        : arrivedCount !== undefined
          ? { arrivedCount }
          : {}),
      // GDPR-gallring: allergiuppgiften raderas när besöket är genomfört
      // (samtyckesloggen behålls som bevis)
      ...(completing ? { allergyNote: null } : {}),
      // Avbokning: vem/varför/när (§1). Kortet behålls i 7 dagar för
      // återaktivering (§3.5) — gallringscronen städar.
      ...(status === "CANCELLED" && booking.status !== "CANCELLED"
        ? {
            cancelInfo: {
              av: "personal",
              ...(cancelReason?.trim() ? { orsak: cancelReason.trim() } : {}),
              tidpunkt: new Date().toISOString(),
            },
          }
        : {}),
      ...(reactivate ? { cancelInfo: Prisma.DbNull } : {}),
    };

    const updated = completing
      ? await prisma.$transaction(async (tx) => {
          const b = await tx.booking.update({
            where: { id: booking.id },
            data,
            include: { table: { select: { name: true } } },
          });
          // Besöksstatistik uppdateras endast vid övergången till COMPLETED
          await tx.guestProfile.upsert({
            where: { guestId: booking.guestId },
            update: { visitCount: { increment: 1 }, lastVisit: booking.startsAt },
            create: {
              guestId: booking.guestId,
              visitCount: 1,
              lastVisit: booking.startsAt,
            },
          });
          return b;
        })
      : await prisma.booking.update({
          where: { id: booking.id },
          data,
          include: { table: { select: { name: true } } },
        });

    // Återaktivering till PENDING: gästen behöver kortlänken på nytt
    if (reactivate && status === "PENDING") {
      const sent = await sendCardLink(booking.id, request.nextUrl.origin);
      if (!sent.ok) {
        console.error(`Kortlänken gick inte att skicka: ${sent.error}`);
      }
    }

    // Bekräftelsemejl vid Bekräfta (PENDING → CONFIRMED) — best-effort,
    // skickas bara en gång per bokning
    if (
      status === "CONFIRMED" &&
      booking.status === "PENDING" &&
      booking.guest.email &&
      !booking.confirmationSentAt
    ) {
      try {
        const config = parseRestaurantConfig(restaurant.config);
        const local = new Intl.DateTimeFormat("sv-SE", {
          timeZone: config.timezone,
          dateStyle: "short",
          timeStyle: "short",
        }).format(updated.startsAt);
        const sent = await sendEmail({
          to: booking.guest.email,
          subject: `Bokningsbekräftelse — ${restaurant.name}`,
          text:
            `Hej${booking.guest.name ? ` ${booking.guest.name}` : ""}!\n\n` +
            `Din bokning för ${updated.partySize} ${updated.partySize === 1 ? "person" : "personer"} ` +
            `${local} är bekräftad.\n\nVälkommen!\n${restaurant.name}`,
        });
        if (sent.ok) {
          await prisma.booking.update({
            where: { id: booking.id },
            data: { confirmationSentAt: new Date() },
          });
        }
      } catch (e) {
        console.error("Kunde inte skicka bokningsbekräftelse:", e);
      }
    }

    return NextResponse.json({
      id: updated.id,
      tableId: updated.tableId,
      tableName: updated.table?.name ?? null,
      status: updated.status,
      startsAt: updated.startsAt.toISOString(),
      endsAt: updated.endsAt.toISOString(),
      arrivedCount: updated.arrivedCount,
      staffNote: updated.staffNote,
    });
  } catch (e) {
    if (isOverlapViolation(e)) {
      return NextResponse.json(
        {
          error: reactivate
            ? "Bordet har hunnit bokas — flytta bokningen till en annan tid eller ett annat bord först."
            : newTimes
              ? "Bordet är upptaget den tiden — välj en annan tid eller flytta bordet först."
              : "Bordet är upptaget den tiden — välj ett annat bord.",
        },
        { status: 409 },
      );
    }
    throw e;
  }
}
