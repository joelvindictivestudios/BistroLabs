-- OBS: prisma migrate diff föreslog DROP av HNSW-indexen (de kan inte uttryckas
-- i Prisma-schemat) — de raderna är medvetet BORTTAGNA. Rör aldrig embedding-indexen.

-- AlterTable
ALTER TABLE "tables" ADD COLUMN     "min_seats" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "pos_x" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "pos_y" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "room_id" UUID,
ADD COLUMN     "shape" TEXT NOT NULL DEFAULT 'round';

-- CreateTable
CREATE TABLE "rooms" (
    "id" UUID NOT NULL,
    "restaurant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "rooms_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "rooms_restaurant_id_name_key" ON "rooms"("restaurant_id", "name");

-- AddForeignKey
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tables" ADD CONSTRAINT "tables_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: samla varje restaurangs befintliga bord i standardrummet "Matsalen"
-- med prydliga rasterpositioner (4 bord per rad, 3 celler mellan)
INSERT INTO "rooms" ("id", "restaurant_id", "name", "sort_order")
SELECT gen_random_uuid(), r."id", 'Matsalen', 0
FROM "restaurants" r
WHERE EXISTS (SELECT 1 FROM "tables" t WHERE t."restaurant_id" = r."id");

WITH numbered AS (
  SELECT t."id" AS table_id,
         rm."id" AS room_id,
         ROW_NUMBER() OVER (PARTITION BY t."restaurant_id" ORDER BY t."name") AS rn
  FROM "tables" t
  JOIN "rooms" rm
    ON rm."restaurant_id" = t."restaurant_id" AND rm."name" = 'Matsalen'
)
UPDATE "tables" SET
  "room_id" = numbered.room_id,
  "pos_x"   = (((numbered.rn - 1) % 4) * 3)::int,
  "pos_y"   = (((numbered.rn - 1) / 4) * 3)::int
FROM numbered
WHERE "tables"."id" = numbered.table_id;
