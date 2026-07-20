import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db/client";
import { getUser } from "@/lib/auth/server";
import { parseRestaurantConfig } from "@/lib/email-concierge/types";
import {
  cancellationDeadline,
  formatDeadlineTime,
} from "@/lib/booking/policy";
import { buildManageUrl } from "@/lib/booking/manage-token";
import { appBaseUrl } from "@/lib/urls";
import {
  bekraftelseMail,
  kortlankMail,
  paminnelseMail,
  formatBookingWhen,
} from "@/lib/messaging/templates";

// GET .../bookings/{id}/utskick — "Visa utskick" (§3.7): de tre mallarna
// renderade med bokningens riktiga data via EXAKT samma builders som de
// skarpa utskicken — previewn är alltid byte-trogen.
export async function GET(
  request: NextRequest,
  ctx: RouteContext<"/api/restaurants/[slug]/bookings/[id]/utskick">,
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
    include: {
      guest: { select: { name: true, email: true } },
      table: { select: { name: true } },
    },
  });
  if (!booking) {
    return NextResponse.json({ error: "Okänd bokning." }, { status: 404 });
  }

  const config = parseRestaurantConfig(restaurant.config);
  const data = {
    restaurantName: restaurant.name,
    guestName: booking.guest.name,
    whenText: formatBookingWhen(booking.startsAt, config.timezone),
    partySize: booking.partySize,
    tableName: booking.table?.name ?? null,
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
  };
  const timeFmt = new Intl.DateTimeFormat("sv-SE", {
    timeZone: config.timezone,
    hour: "2-digit",
    minute: "2-digit",
  });

  return NextResponse.json({
    to: booking.guest.email
      ? `${booking.guest.name ?? "Gäst"} <${booking.guest.email}>`
      : "— ingen e-post på bokningen —",
    from: `${restaurant.name} · via BistroLabs`,
    templates: [
      { key: "bekraftelse", label: "Bekräftelse", ...bekraftelseMail(data) },
      {
        key: "kortlank",
        label: "Kortlänk",
        ...kortlankMail({
          ...data,
          deadlineText: `kl ${formatDeadlineTime(
            cancellationDeadline(booking.startsAt, config),
            config.timezone,
          )}`,
        }),
      },
      {
        key: "paminnelse",
        label: "Påminnelse",
        ...paminnelseMail({
          ...data,
          timeText: timeFmt.format(booking.startsAt),
        }),
      },
    ],
  });
}
