import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/client";
import { getUser } from "@/lib/auth/server";

// Kundregistret (CRM): lista/sök + skapa kund från adminpanelen.
// Regel: e-post ELLER telefon krävs, namn valfritt.

const createGuestSchema = z
  .object({
    name: z.string().max(120).optional(),
    email: z.email().optional(),
    phone: z.string().min(5).max(30).optional(),
    notes: z.string().max(1000).optional(),
  })
  .refine((d) => d.email || d.phone, {
    message: "Ange e-post eller telefonnummer",
    path: ["email"],
  });

async function authorize(request: NextRequest, slug: string) {
  const user = await getUser();
  if (!user) return { error: "Inte inloggad.", status: 401 as const };
  const restaurant = await prisma.restaurant.findUnique({ where: { slug } });
  if (!restaurant) return { error: "Okänd restaurang.", status: 404 as const };
  if (restaurant.ownerId !== user.id)
    return { error: "Du äger inte den här restaurangen.", status: 403 as const };
  return { restaurant };
}

export async function GET(
  request: NextRequest,
  ctx: RouteContext<"/api/restaurants/[slug]/guests">,
) {
  const { slug } = await ctx.params;
  const auth = await authorize(request, slug);
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const q = request.nextUrl.searchParams.get("q")?.trim() ?? "";
  const guests = await prisma.guest.findMany({
    where: {
      restaurantId: auth.restaurant.id,
      ...(q
        ? {
            OR: [
              { name: { contains: q, mode: "insensitive" } },
              { email: { contains: q, mode: "insensitive" } },
              { phone: { contains: q } },
            ],
          }
        : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 50,
    include: {
      profile: {
        select: {
          notes: true,
          visitCount: true,
          lastVisit: true,
          marketingConsent: true,
        },
      },
      // Avbokningar och no-shows räknas inte som bokningar i kundlistan
      _count: {
        select: {
          bookings: {
            where: { status: { notIn: ["CANCELLED", "NO_SHOW"] } },
          },
        },
      },
    },
  });

  return NextResponse.json({
    guests: guests.map((g) => ({
      id: g.id,
      name: g.name,
      email: g.email,
      phone: g.phone,
      notes: g.profile?.notes ?? "",
      bookingCount: g._count.bookings,
      visitCount: g.profile?.visitCount ?? 0,
      marketingConsent: g.profile?.marketingConsent ?? false,
      lastVisit: g.profile?.lastVisit?.toISOString() ?? null,
      createdAt: g.createdAt.toISOString(),
    })),
  });
}

export async function POST(
  request: NextRequest,
  ctx: RouteContext<"/api/restaurants/[slug]/guests">,
) {
  const { slug } = await ctx.params;
  const auth = await authorize(request, slug);
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const parsed = createGuestSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Ogiltiga uppgifter" },
      { status: 400 },
    );
  }
  const body = parsed.data;

  // Dubblettkoll med begripligt fel (unik per restaurang på email resp. phone)
  const existing = await prisma.guest.findFirst({
    where: {
      restaurantId: auth.restaurant.id,
      OR: [
        ...(body.email ? [{ email: body.email }] : []),
        ...(body.phone ? [{ phone: body.phone }] : []),
      ],
    },
  });
  if (existing) {
    return NextResponse.json(
      {
        error: `Kunden finns redan (${existing.name ?? existing.email ?? existing.phone}).`,
        guestId: existing.id,
      },
      { status: 409 },
    );
  }

  const guest = await prisma.guest.create({
    data: {
      restaurantId: auth.restaurant.id,
      name: body.name?.trim() || null,
      email: body.email || null,
      phone: body.phone || null,
    },
  });
  if (body.notes?.trim()) {
    await prisma.guestProfile.create({
      data: { guestId: guest.id, notes: body.notes.trim() },
    });
  }

  return NextResponse.json(
    {
      id: guest.id,
      name: guest.name,
      email: guest.email,
      phone: guest.phone,
      notes: body.notes?.trim() ?? "",
      bookingCount: 0,
      visitCount: 0,
      marketingConsent: false,
      lastVisit: null,
      createdAt: guest.createdAt.toISOString(),
    },
    { status: 201 },
  );
}
