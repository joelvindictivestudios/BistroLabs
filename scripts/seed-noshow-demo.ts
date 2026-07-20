import { prisma } from "../lib/db/client";
import {
  parseRestaurantConfig,
  type RestaurantConfig,
} from "../lib/email-concierge/types";
import { localToUtc } from "../lib/booking/availability";

// Demodata för no-show-skyddet: fyller en restaurang (env SLUG, default
// "toso") med gäster, historik (besök/no-shows/avbokningar), kvällens
// bokningar i alla statusar, väntelista och kommunikationsloggar — så att
// Översiktens KPI:er, Rapporternas före/efter-grafer och Gäster-vyn har
// något att visa.
//
// Återkörningsbart: allt som skapas märks med e-postdomänen
// @demo.bistrolabs.se (väntelistan med 0700000-prefix) och rensas först.
//
// Kör: npx tsx --env-file=.env scripts/seed-noshow-demo.ts

const SLUG = process.env.SLUG ?? "toso";
const MARKER = "@demo.bistrolabs.se";
const WL_PHONE_PREFIX = "0700000";

const DAY = 864e5;

function localDate(tz: string, daysFromNow: number): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: tz }).format(
    new Date(Date.now() + daysFromNow * DAY),
  );
}

async function main() {
  const restaurant = await prisma.restaurant.findUnique({
    where: { slug: SLUG },
  });
  if (!restaurant) throw new Error(`Restaurangen "${SLUG}" finns inte.`);
  const config: RestaurantConfig = parseRestaurantConfig(restaurant.config);
  const tz = config.timezone;

  // --- Städa tidigare demodata ---
  const oldGuests = await prisma.guest.findMany({
    where: { restaurantId: restaurant.id, email: { endsWith: MARKER } },
    select: { id: true },
  });
  const oldIds = oldGuests.map((g) => g.id);
  if (oldIds.length > 0) {
    await prisma.booking.deleteMany({ where: { guestId: { in: oldIds } } });
    await prisma.guest.deleteMany({ where: { id: { in: oldIds } } });
  }
  await prisma.waitlistEntry.deleteMany({
    where: {
      restaurantId: restaurant.id,
      phone: { startsWith: WL_PHONE_PREFIX },
    },
  });
  console.log(`Städade ${oldIds.length} demogäster med bokningar.`);

  // --- Referenspunkt för rapporternas före/efter: kortgarantin "infördes"
  //     för 30 dagar sedan ---
  const guaranteeSince = localDate(tz, -30);
  await prisma.restaurant.update({
    where: { id: restaurant.id },
    data: { config: { ...config, cardGuaranteeSince: guaranteeSince } },
  });

  // --- Gäster + profiler (märkningar inkl. egna fritextmärkningar) ---
  const GUESTS: {
    key: string;
    name: string;
    phone: string;
    tags: string[];
    notes?: string;
  }[] = [
    { key: "mikael", name: "Mikael Nyström", phone: "070-567 89 01", tags: ["stamgäst", "VIP"] },
    { key: "anna", name: "Anna Lindqvist", phone: "073-234 56 78", tags: ["stamgäst"], notes: "Föredrar lugnt bord." },
    { key: "erik", name: "Erik Johansson", phone: "070-345 67 89", tags: ["allergi", "Vinklubben"], notes: "Nötallergi i sällskapet." },
    { key: "lisa", name: "Lisa Holm", phone: "076-890 12 34", tags: ["barnfamilj"] },
    { key: "petra", name: "Petra Sandberg", phone: "073-678 90 12", tags: ["allergi"] },
    { key: "sofia", name: "Sofia Karlsson", phone: "076-456 78 90", tags: [] },
    { key: "david", name: "David Forsberg", phone: "070-901 23 45", tags: [] },
    { key: "bergstrom", name: "Familjen Bergström", phone: "070-123 45 67", tags: ["barnfamilj"], notes: "Vill gärna sitta vid fönstret." },
  ];
  const guestId = new Map<string, string>();
  for (const g of GUESTS) {
    const created = await prisma.guest.create({
      data: {
        restaurantId: restaurant.id,
        name: g.name,
        phone: g.phone,
        email: `${g.key}${MARKER}`,
      },
    });
    guestId.set(g.key, created.id);
    await prisma.guestProfile.create({
      data: {
        guestId: created.id,
        tags: g.tags,
        notes: g.notes,
      },
    });
  }
  console.log(`Skapade ${GUESTS.length} gäster.`);

  // --- Historik senaste 8 veckorna (tableId null — konstrainten lämnas ifred) ---
  const visitCount = new Map<string, number>();
  const lastVisit = new Map<string, Date>();
  let created = 0;

  const mkBooking = async (opts: {
    key: string;
    daysAgo: number;
    time: string;
    party: number;
    status: "COMPLETED" | "NO_SHOW" | "CANCELLED";
    charged?: number;
    cancelledBy?: "personal" | "gäst" | "auto";
    cardLast4?: string;
  }) => {
    const date = localDate(tz, -opts.daysAgo);
    const startsAt = localToUtc(date, opts.time, tz);
    const endsAt = new Date(startsAt.getTime() + 2 * 3600_000);
    const booking = await prisma.booking.create({
      data: {
        restaurantId: restaurant.id,
        guestId: guestId.get(opts.key)!,
        startsAt,
        endsAt,
        partySize: opts.party,
        status: opts.status,
        createdBy: "dropin",
        createdAt: new Date(startsAt.getTime() - 3 * DAY),
        ...(opts.charged !== undefined
          ? { charged: opts.charged, cardLast4: opts.cardLast4 ?? "4761" }
          : {}),
        ...(opts.cancelledBy
          ? {
              cancelInfo: {
                av: opts.cancelledBy,
                ...(opts.cancelledBy === "auto"
                  ? { orsak: "Ej bekräftad före deadline" }
                  : {}),
                tidpunkt: new Date(startsAt.getTime() - 6 * 3600_000).toISOString(),
              },
            }
          : {}),
      },
    });
    if (opts.status === "COMPLETED") {
      visitCount.set(opts.key, (visitCount.get(opts.key) ?? 0) + 1);
      const prev = lastVisit.get(opts.key);
      if (!prev || startsAt > prev) lastVisit.set(opts.key, startsAt);
    }
    if (opts.status === "NO_SHOW" && opts.charged !== undefined) {
      await prisma.communicationLog.create({
        data: {
          bookingId: booking.id,
          type: "FEE_CHARGED",
          channel: null,
          meta: { belopp: opts.charged, chargeId: "seed-demo" },
        },
      });
    }
    created++;
  };

  const keys = GUESTS.map((g) => g.key);
  const times = ["17:30", "18:00", "18:30", "19:00", "19:30", "20:00"];
  // Genomförda besök: ~4 per vecka, spridda över veckodagar och gäster
  for (let week = 8; week >= 1; week--) {
    for (let i = 0; i < 4; i++) {
      await mkBooking({
        key: keys[(week * 3 + i) % keys.length],
        daysAgo: week * 7 - i - 1,
        time: times[(week + i) % times.length],
        party: 2 + ((week + i) % 4),
        status: "COMPLETED",
      });
    }
  }
  // No-shows FÖRE kortgarantin (dag 56–31): många och odebiterade
  for (const [i, daysAgo] of [55, 52, 48, 45, 41, 38, 34, 32].entries()) {
    await mkBooking({
      key: keys[i % keys.length],
      daysAgo,
      time: times[i % times.length],
      party: 2 + (i % 3),
      status: "NO_SHOW",
    });
  }
  // No-shows EFTER kortgarantin (senaste 30): få — två debiterade, en utan kort
  await mkBooking({ key: "erik", daysAgo: 18, time: "19:00", party: 4, status: "NO_SHOW", charged: 1000, cardLast4: "5310" });
  await mkBooking({ key: "anna", daysAgo: 9, time: "18:30", party: 2, status: "NO_SHOW", charged: 500, cardLast4: "4761" });
  await mkBooking({ key: "sofia", daysAgo: 5, time: "19:30", party: 2, status: "NO_SHOW" });
  // Avbokningar senaste 30 dagarna: personal, gäst själv och auto
  for (const [i, spec] of (
    [
      [26, "personal"],
      [22, "gäst"],
      [20, "auto"],
      [15, "personal"],
      [12, "auto"],
      [8, "gäst"],
      [4, "auto"],
      [2, "personal"],
    ] as const
  ).entries()) {
    await mkBooking({
      key: keys[(i + 2) % keys.length],
      daysAgo: spec[0],
      time: times[i % times.length],
      party: 2 + (i % 4),
      status: "CANCELLED",
      cancelledBy: spec[1],
    });
  }
  console.log(`Skapade ${created} historiska bokningar.`);

  // Profilernas besöksstatistik ska stämma med historiken
  for (const g of GUESTS) {
    await prisma.guestProfile.update({
      where: { guestId: guestId.get(g.key)! },
      data: {
        visitCount: visitCount.get(g.key) ?? 0,
        lastVisit: lastVisit.get(g.key) ?? null,
      },
    });
  }

  // --- Kvällens bokningar (med bord där det går — krock → utan bord) ---
  const tables = await prisma.diningTable.findMany({
    where: { restaurantId: restaurant.id },
    orderBy: { capacity: "asc" },
  });
  const pickTable = (party: number, used: Set<string>) =>
    tables.find((t) => t.capacity >= party && !used.has(t.id)) ?? null;

  const today = localDate(tz, 0);
  const usedTables = new Set<string>();
  const TONIGHT: {
    key: string;
    time: string;
    party: number;
    status: "SEATED" | "CONFIRMED" | "PENDING";
    card?: string;
    logs: ("RECEIVED" | "CARD_LINK" | "CONFIRMATION")[];
  }[] = [
    { key: "bergstrom", time: "17:00", party: 4, status: "SEATED", card: "4242", logs: ["RECEIVED", "CONFIRMATION"] },
    { key: "erik", time: "18:00", party: 6, status: "CONFIRMED", card: "5310", logs: ["RECEIVED", "CONFIRMATION"] },
    { key: "sofia", time: "18:30", party: 2, status: "PENDING", logs: ["RECEIVED", "CARD_LINK"] },
    { key: "anna", time: "19:00", party: 2, status: "CONFIRMED", card: "4761", logs: ["RECEIVED", "CONFIRMATION"] },
    { key: "david", time: "19:00", party: 2, status: "CONFIRMED", logs: ["RECEIVED"] },
    { key: "mikael", time: "19:30", party: 4, status: "CONFIRMED", card: "9034", logs: ["RECEIVED", "CONFIRMATION"] },
    { key: "lisa", time: "20:00", party: 5, status: "CONFIRMED", card: "6120", logs: ["RECEIVED", "CONFIRMATION"] },
    { key: "petra", time: "20:30", party: 3, status: "PENDING", logs: ["RECEIVED", "CARD_LINK"] },
  ];
  let tonight = 0;
  for (const b of TONIGHT) {
    const startsAt = localToUtc(today, b.time, tz);
    const endsAt = new Date(startsAt.getTime() + 2 * 3600_000);
    const table = pickTable(b.party, usedTables);
    const data = {
      restaurantId: restaurant.id,
      guestId: guestId.get(b.key)!,
      startsAt,
      endsAt,
      partySize: b.party,
      status: b.status,
      createdBy: "widget",
      createdAt: new Date(Date.now() - 2 * DAY),
      ...(b.status === "SEATED"
        ? { seatedAt: new Date(), arrivedCount: b.party }
        : {}),
      ...(b.card
        ? { cardPspToken: `stub_tok_seed-${b.key}`, cardLast4: b.card }
        : {}),
      ...(b.logs.includes("CONFIRMATION")
        ? { confirmationSentAt: new Date(Date.now() - 2 * DAY) }
        : {}),
    };
    let booking;
    try {
      booking = await prisma.booking.create({
        data: { ...data, tableId: table?.id ?? null },
      });
      if (table) usedTables.add(table.id);
    } catch {
      // Bordet kolliderade med en riktig bokning — ta utan bord
      booking = await prisma.booking.create({
        data: { ...data, tableId: null },
      });
    }
    for (const type of b.logs) {
      await prisma.communicationLog.create({
        data: {
          bookingId: booking.id,
          type,
          channel: type === "RECEIVED" ? null : "EMAIL",
          meta: type === "RECEIVED" ? { kalla: "widget" } : { till: `${b.key}${MARKER}` },
        },
      });
    }
    tonight++;
  }
  console.log(`Skapade ${tonight} bokningar ikväll (${today}).`);

  // --- Väntelistan ikväll ---
  await prisma.waitlistEntry.createMany({
    data: [
      { restaurantId: restaurant.id, name: "Elsa Björk", phone: `${WL_PHONE_PREFIX}01`, partySize: 2, date: today, wishedFrom: "19:00", wishedTo: "20:00" },
      { restaurantId: restaurant.id, name: "Hugo Lantz", phone: `${WL_PHONE_PREFIX}02`, partySize: 4, date: today, wishedFrom: "18:30", wishedTo: "19:30" },
      { restaurantId: restaurant.id, name: "Vera Sund", phone: `${WL_PHONE_PREFIX}03`, partySize: 2, date: today, wishedFrom: "20:00", wishedTo: "21:00", status: "OFFERED", offeredTime: "20:00", offeredAt: new Date() },
    ],
  });
  console.log("Skapade 3 väntelisteposter (2 väntar, 1 erbjuden).");

  console.log(
    `\nKlart! Kortgarantin "infördes" ${guaranteeSince}. Titta på:\n` +
      `  /company/${SLUG}            (Översikt: KPI:er, kvällens kurva, väntelisteglimt)\n` +
      `  /company/${SLUG}/rapporter  (före/efter, debiterade avgifter, auto-avbokningar)\n` +
      `  /company/${SLUG}/customers  (märkningar inkl. egna, historik, no-shows)\n` +
      `  /bookings/${SLUG}           (gul preliminär-panel, kort på bokningar, väntelistekort)`,
  );
}

main().then(() => process.exit(0));
