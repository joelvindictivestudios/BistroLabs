import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db/client";
import { getUser } from "@/lib/auth/server";

// GET /api/restaurants/{slug}/waitlist?date=YYYY-MM-DD — personalens
// väntelistekort (§3.8). Separat från /day: dagvyns refetch drivs av
// Realtime på bookings; väntelistan hämtas vid load + efter egna åtgärder.
export async function GET(
  request: NextRequest,
  ctx: RouteContext<"/api/restaurants/[slug]/waitlist">,
) {
  const user = await getUser();
  if (!user) {
    return NextResponse.json({ error: "Inte inloggad." }, { status: 401 });
  }
  const { slug } = await ctx.params;
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

  const date = request.nextUrl.searchParams.get("date");
  const entries = await prisma.waitlistEntry.findMany({
    where: {
      restaurantId: restaurant.id,
      ...(date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? { date } : {}),
    },
    orderBy: { createdAt: "asc" }, // kön: äldst först
  });

  return NextResponse.json({
    waitlist: entries.map((e) => ({
      id: e.id,
      name: e.name,
      phone: e.phone,
      partySize: e.partySize,
      date: e.date,
      wishedFrom: e.wishedFrom,
      wishedTo: e.wishedTo,
      status: e.status,
      offeredTime: e.offeredTime,
    })),
  });
}
