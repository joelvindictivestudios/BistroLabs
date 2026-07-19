import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/client";
import { getUser } from "@/lib/auth/server";
import {
  parseRestaurantConfig,
  type RestaurantConfig,
} from "@/lib/email-concierge/types";
import {
  normalizeOpeningHours,
  openingHoursPatchSchema,
} from "@/lib/restaurant/hours";

const patchSchema = z.object({
  name: z.string().min(2).max(80).optional(),
  menu: z.string().max(1000).optional(),
  heroImageUrl: z.union([z.url(), z.literal("")]).optional(),
  logoUrl: z.union([z.url(), z.literal("")]).optional(),
  address: z.string().max(200).optional(),
  closedDates: z
    .array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/))
    .max(100)
    .optional(),
  bookingStopDates: z
    .array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/))
    .max(100)
    .optional(),
  sameDayCutoff: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .nullable()
    .optional(),
  voiceAgent: z
    .object({
      voice: z.string().max(30),
      greeting: z.string().max(500),
      maxWaitSeconds: z.number().int().min(5).max(120),
      transferNumber: z.string().max(30),
    })
    .partial()
    .optional(),
  escalationPartySize: z.number().int().min(1).max(50).optional(),
  published: z.boolean().optional(),
  theme: z.enum(["classic", "warm", "light"]).optional(),
  widgetTheme: z.enum(["classic", "warm-light"]).optional(),
  // Flera pass per dag; gamla klienters {open,close}|null accepteras också
  openingHours: openingHoursPatchSchema.optional(),
  offerings: z
    .array(
      z.object({
        id: z.string().optional(),
        title: z.string().min(1).max(60),
        description: z.string().max(200).default(""),
        imageUrl: z.union([z.url(), z.literal("")]).default(""),
      }),
    )
    .max(8)
    .optional(),
});

// PATCH /api/restaurants/{slug} — partiell uppdatering av namn/config/publicering.
// Editorns "Spara" och "Publicera" går båda hit.
export async function PATCH(
  request: NextRequest,
  ctx: RouteContext<"/api/restaurants/[slug]">,
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

  const parsed = patchSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Ogiltiga uppgifter", details: parsed.error.issues },
      { status: 400 },
    );
  }
  const body = parsed.data;

  // Merge in i befintlig config — bara skickade fält skrivs över
  const config: RestaurantConfig = parseRestaurantConfig(restaurant.config);
  if (body.menu !== undefined) config.menu = body.menu;
  if (body.heroImageUrl !== undefined) config.heroImageUrl = body.heroImageUrl;
  if (body.logoUrl !== undefined) config.logoUrl = body.logoUrl;
  if (body.address !== undefined) config.address = body.address;
  if (body.closedDates !== undefined) config.closedDates = body.closedDates;
  if (body.bookingStopDates !== undefined)
    config.bookingStopDates = body.bookingStopDates;
  if (body.sameDayCutoff !== undefined)
    config.sameDayCutoff = body.sameDayCutoff;
  if (body.voiceAgent !== undefined) {
    // phoneNumber/phoneSid skrivs ENDAST av phone-number-endpointen
    config.voiceAgent = { ...config.voiceAgent, ...body.voiceAgent };
  }
  if (body.escalationPartySize !== undefined)
    config.escalationPartySize = body.escalationPartySize;
  if (body.theme !== undefined) config.theme = body.theme;
  if (body.widgetTheme !== undefined) config.widgetTheme = body.widgetTheme;
  if (body.openingHours !== undefined) {
    const normalized = normalizeOpeningHours(body.openingHours);
    if (!normalized.ok) {
      return NextResponse.json({ error: normalized.error }, { status: 400 });
    }
    config.openingHours = normalized.openingHours;
  }
  if (body.offerings !== undefined) {
    config.offerings = body.offerings.map((o, i) => ({
      id: o.id ?? `offering-${i + 1}`,
      title: o.title,
      description: o.description,
      imageUrl: o.imageUrl,
    }));
  }

  // Bord hanteras numera av bordskartan: PUT /api/restaurants/{slug}/floor-plan

  const updated = await prisma.restaurant.update({
    where: { id: restaurant.id },
    data: {
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.published !== undefined ? { published: body.published } : {}),
      config,
    },
  });

  return NextResponse.json({
    slug: updated.slug,
    name: updated.name,
    published: updated.published,
    widgetPath: `/widget/${updated.slug}`,
  });
}
