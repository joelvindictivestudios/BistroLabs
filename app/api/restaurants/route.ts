import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/client";
import { getUser } from "@/lib/auth/server";
import type { RestaurantConfig } from "@/lib/email-concierge/types";

const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

// Minimal payload: namn + slug räcker (create-restaurant-flödet).
// Resten får vettiga defaults och ställs in i editorn efteråt.
const registerSchema = z.object({
  name: z.string().min(2).max(80),
  slug: z
    .string()
    .min(2)
    .max(40)
    .regex(/^[a-z0-9-]+$/, "Endast a–z, 0–9 och bindestreck"),
  email: z.email().optional(),
  menu: z.string().max(1000).default(""),
  heroImageUrl: z.union([z.url(), z.literal("")]).default(""),
  openingHours: z
    .partialRecord(
      z.enum(WEEKDAYS),
      z.object({ open: z.string().regex(/^\d{2}:\d{2}$/), close: z.string().regex(/^\d{2}:\d{2}$/) }).nullable(),
    )
    .default({
      tue: { open: "17:00", close: "23:00" },
      wed: { open: "17:00", close: "23:00" },
      thu: { open: "17:00", close: "23:00" },
      fri: { open: "17:00", close: "23:00" },
      sat: { open: "17:00", close: "23:00" },
    }),
  tables: z
    .object({
      two: z.number().int().min(0).max(50),
      four: z.number().int().min(0).max(50),
      six: z.number().int().min(0).max(50),
    })
    .default({ two: 4, four: 3, six: 1 }),
  offerings: z
    .array(
      z.object({
        title: z.string().min(1).max(60),
        description: z.string().max(200).default(""),
        imageUrl: z.union([z.url(), z.literal("")]).default(""),
      }),
    )
    .max(8)
    .default([{ title: "Middag", description: "", imageUrl: "" }]),
  escalationPartySize: z.number().int().min(1).max(50).default(8),
});

export async function POST(request: NextRequest) {
  const user = await getUser();
  if (!user) {
    return NextResponse.json(
      { error: "Du måste vara inloggad för att skapa en restaurang." },
      { status: 401 },
    );
  }

  const parsed = registerSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Ogiltiga uppgifter", details: parsed.error.issues },
      { status: 400 },
    );
  }
  const body = parsed.data;

  const existing = await prisma.restaurant.findUnique({
    where: { slug: body.slug },
  });
  if (existing) {
    return NextResponse.json(
      { error: `Adressen "${body.slug}" är upptagen — välj en annan.` },
      { status: 409 },
    );
  }

  const openingHours: RestaurantConfig["openingHours"] = {};
  for (const day of WEEKDAYS) {
    const range = body.openingHours[day] ?? null;
    if (range) openingHours[day] = [range];
  }
  if (Object.keys(openingHours).length === 0) {
    return NextResponse.json(
      { error: "Minst en dag måste ha öppettider." },
      { status: 400 },
    );
  }

  const totalTables = body.tables.two + body.tables.four + body.tables.six;
  if (totalTables === 0) {
    return NextResponse.json(
      { error: "Lägg till minst ett bord." },
      { status: 400 },
    );
  }

  const config: RestaurantConfig = {
    timezone: "Europe/Stockholm",
    openingHours,
    bookingDurationMinutes: 120,
    escalationPartySize: body.escalationPartySize,
    confidenceThreshold: 0.7,
    tone: {
      styleGuide:
        `Varm och professionell. Svara på svenska, kortfattat och personligt. ` +
        `Bekräfta alltid datum, tid och antal gäster. Avsluta med 'Varma hälsningar, ${body.name}'.`,
      fewShotExamples: [],
    },
    menu: body.menu,
    offerings: body.offerings.map((o, i) => ({
      id: `offering-${i + 1}`,
      title: o.title,
      description: o.description,
      imageUrl: o.imageUrl,
    })),
    heroImageUrl: body.heroImageUrl,
    logoUrl: "",
    address: "",
    closedDates: [],
    bookingStopDates: [],
    sameDayCutoff: "14:00",
    voiceAgent: {
      voice: "coral",
      greeting: "",
      maxWaitSeconds: 20,
      transferNumber: "",
      phoneNumber: "",
      phoneSid: "",
    },
  };

  // Standardbord placeras i rummet "Matsalen" på ett prydligt raster
  // (4 bord per rad) — redigeras sedan i bordskartan under Ditt företag
  const capacities = [
    ...Array.from({ length: body.tables.two }, () => 2),
    ...Array.from({ length: body.tables.four }, () => 4),
    ...Array.from({ length: body.tables.six }, () => 6),
  ];
  const tableData = capacities.map((capacity, i) => ({
    name: `T${i + 1}`,
    capacity,
    minSeats: 1,
    shape: capacity >= 6 ? "rect" : "round",
    posX: (i % 4) * 3,
    posY: Math.floor(i / 4) * 3,
  }));

  const restaurant = await prisma.restaurant.create({
    data: {
      slug: body.slug,
      name: body.name,
      ownerId: user.id,
      config,
    },
  });
  const room = await prisma.room.create({
    data: { restaurantId: restaurant.id, name: "Matsalen", sortOrder: 0 },
  });
  await prisma.diningTable.createMany({
    data: tableData.map((t) => ({
      ...t,
      restaurantId: restaurant.id,
      roomId: room.id,
    })),
  });

  return NextResponse.json(
    {
      slug: restaurant.slug,
      widgetPath: `/widget/${restaurant.slug}`,
      editorPath: `/editor/${restaurant.slug}`,
    },
    { status: 201 },
  );
}
