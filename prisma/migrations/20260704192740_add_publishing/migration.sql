-- AlterTable
ALTER TABLE "restaurants" ADD COLUMN     "published" BOOLEAN NOT NULL DEFAULT false;

-- Backfill: restauranger skapade före publiceringsflödet förblir publika
UPDATE "restaurants" SET "published" = true;
