import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/client";
import { getUser } from "@/lib/auth/server";

const floorPlanSchema = z.object({
  rooms: z
    .array(
      z.object({
        id: z.uuid().optional(), // befintligt rum
        key: z.string().min(1).max(40), // klientens stabila referens
        name: z.string().min(1).max(30),
        sortOrder: z.number().int().min(0).max(100),
      }),
    )
    .min(1)
    .max(12),
  tables: z
    .array(
      z
        .object({
          id: z.uuid().optional(), // befintligt bord
          roomKey: z.string().min(1).max(40),
          name: z.string().min(1).max(30),
          capacity: z.number().int().min(1).max(20),
          minSeats: z.number().int().min(1).max(20),
          shape: z.enum(["round", "square", "rect"]),
          posX: z.number().int().min(0).max(40),
          posY: z.number().int().min(0).max(40),
        })
        .refine((t) => t.minSeats <= t.capacity, {
          message: "minSeats får inte överstiga capacity",
        }),
    )
    .max(200),
});

// PUT /api/restaurants/{slug}/floor-plan — sparar hela bordskartan i en
// transaktion: upsertar rum och bord, raderar det som tagits bort i UI:t.
// Bord med bokningar kan inte raderas (409 med bordsnamnen).
export async function PUT(
  request: NextRequest,
  ctx: RouteContext<"/api/restaurants/[slug]/floor-plan">,
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

  const parsed = floorPlanSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Ogiltig bordskarta", details: parsed.error.issues },
      { status: 400 },
    );
  }
  const plan = parsed.data;

  // Unika namn inom kartan (DB har unik-constraint per restaurang)
  const tableNames = plan.tables.map((t) => t.name.trim());
  if (new Set(tableNames).size !== tableNames.length) {
    return NextResponse.json(
      { error: "Två bord har samma namn — namnen måste vara unika." },
      { status: 400 },
    );
  }
  const roomKeys = new Set(plan.rooms.map((r) => r.key));
  if (plan.tables.some((t) => !roomKeys.has(t.roomKey))) {
    return NextResponse.json(
      { error: "Ett bord pekar på ett okänt rum." },
      { status: 400 },
    );
  }

  // Radering av bord med bokningar blockeras
  const keptTableIds = plan.tables.flatMap((t) => (t.id ? [t.id] : []));
  const blocked = await prisma.diningTable.findMany({
    where: {
      restaurantId: restaurant.id,
      id: { notIn: keptTableIds },
      bookings: { some: {} },
    },
    select: { name: true },
  });
  if (blocked.length > 0) {
    return NextResponse.json(
      {
        error: `Bord med bokningar kan inte raderas: ${blocked
          .map((b) => b.name)
          .join(", ")}.`,
      },
      { status: 409 },
    );
  }

  let result;
  try {
    result = await runFloorPlanTransaction(restaurant.id, plan, keptTableIds);
  } catch (e) {
    // P2002 = unik-constraint (namnkrock på bord/rum) — t.ex. namnbyte i kors
    if (e && typeof e === "object" && "code" in e && e.code === "P2002") {
      return NextResponse.json(
        {
          error:
            "Namnkrock — två bord eller rum har fått samma namn. Byt namn och spara igen.",
        },
        { status: 409 },
      );
    }
    throw e;
  }

  return NextResponse.json(result);
}

async function runFloorPlanTransaction(
  restaurantId: string,
  plan: z.infer<typeof floorPlanSchema>,
  keptTableIds: string[],
) {
  return prisma.$transaction(async (tx) => {
    // 1. Radera borttagna bord FÖRST — annars krockar nya bord som återanvänder
    //    ett ledigt namn (t.ex. nytt "T5" efter att gamla T5 raderats i UI:t)
    //    med unik-constrainten (restaurant_id, name)
    await tx.diningTable.deleteMany({
      where: { restaurantId, id: { notIn: keptTableIds } },
    });

    // 2. Upserta rum, bygg key → id
    const roomIdByKey = new Map<string, string>();
    for (const room of plan.rooms) {
      if (room.id) {
        await tx.room.update({
          where: { id: room.id },
          data: { name: room.name, sortOrder: room.sortOrder },
        });
        roomIdByKey.set(room.key, room.id);
      } else {
        const created = await tx.room.create({
          data: {
            restaurantId,
            name: room.name,
            sortOrder: room.sortOrder,
          },
        });
        roomIdByKey.set(room.key, created.id);
      }
    }

    // 3. Upserta bord
    const keptIds: string[] = [];
    for (const table of plan.tables) {
      const data = {
        roomId: roomIdByKey.get(table.roomKey)!,
        name: table.name.trim(),
        capacity: table.capacity,
        minSeats: table.minSeats,
        shape: table.shape,
        posX: table.posX,
        posY: table.posY,
      };
      if (table.id) {
        await tx.diningTable.update({ where: { id: table.id }, data });
        keptIds.push(table.id);
      } else {
        const created = await tx.diningTable.create({
          data: { ...data, restaurantId },
        });
        keptIds.push(created.id);
      }
    }

    // 4. Radera rum som tagits bort (SetNull skyddar ev. kvarvarande bord)
    await tx.room.deleteMany({
      where: {
        restaurantId,
        id: { notIn: [...roomIdByKey.values()] },
      },
    });

    return { roomIdByKey: Object.fromEntries(roomIdByKey), tableIds: keptIds };
  });
}
