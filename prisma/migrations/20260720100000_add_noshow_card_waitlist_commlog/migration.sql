-- GPG Booking: no-show-skydd, kortgaranti, väntelista och kommunikationslogg.
-- OBS: `prisma migrate diff` föreslog DROP av HNSW-embeddingindexen
-- (guest_interactions_embedding_idx, knowledge_documents_embedding_idx) —
-- de raderna är medvetet BORTTAGNA. Rör aldrig embedding-indexen.

-- CreateEnum
CREATE TYPE "WaitlistStatus" AS ENUM ('WAITING', 'OFFERED');

-- CreateEnum
CREATE TYPE "CommLogType" AS ENUM ('RECEIVED', 'CARD_LINK', 'CONFIRMATION', 'REMINDER', 'AUTO_CANCELLATION', 'FEE_CHARGED', 'CANCELLATION_CONFIRMATION', 'CHANGE');

-- CreateEnum
CREATE TYPE "CommChannel" AS ENUM ('EMAIL', 'SMS');

-- Bokningar: kortgaranti (PSP-token + last4 — ALDRIG kortnummer, PCI DSS),
-- debiterad no-show-avgift samt vem/varför/när vid avbokning.
ALTER TABLE "bookings" ADD COLUMN     "cancel_info" JSONB,
ADD COLUMN     "card_last4" TEXT,
ADD COLUMN     "card_psp_token" TEXT,
ADD COLUMN     "charged" DECIMAL(10,2);

-- Kundprofil: märkningar (allergi/stamgäst/barnfamilj).
ALTER TABLE "guest_profiles" ADD COLUMN     "tags" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- Matgäst-konton: koppling till Supabase Auth (kind: "guest") — ingen FK,
-- samma skäl som restaurants.owner_id (auth-schemat ägs av Supabase).
ALTER TABLE "guests" ADD COLUMN     "auth_user_id" UUID;

-- CreateTable
CREATE TABLE "waitlist_entries" (
    "id" UUID NOT NULL,
    "restaurant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "party_size" INTEGER NOT NULL,
    "date" TEXT NOT NULL,
    "wished_from" TEXT NOT NULL,
    "wished_to" TEXT NOT NULL,
    "status" "WaitlistStatus" NOT NULL DEFAULT 'WAITING',
    "offered_time" TEXT,
    "offered_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "waitlist_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "communication_logs" (
    "id" UUID NOT NULL,
    "booking_id" UUID NOT NULL,
    "type" "CommLogType" NOT NULL,
    "channel" "CommChannel",
    "meta" JSONB,
    "sent_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "communication_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "waitlist_entries_restaurant_id_date_status_idx" ON "waitlist_entries"("restaurant_id", "date", "status");

-- CreateIndex
CREATE INDEX "communication_logs_booking_id_sent_at_idx" ON "communication_logs"("booking_id", "sent_at");

-- AddForeignKey
ALTER TABLE "waitlist_entries" ADD CONSTRAINT "waitlist_entries_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "communication_logs" ADD CONSTRAINT "communication_logs_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- SÄKERHET: RLS PÅ — nya public-tabeller får annars PostgREST-default-grants
-- via anon-nyckeln (samma motivering som 20260708222646_enable_rls_everywhere).
-- Prisma ansluter som postgres (tabellägare) och påverkas inte; aktivera
-- ALDRIG FORCE ROW LEVEL SECURITY — det bryter appens skrivningar.
ALTER TABLE "waitlist_entries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "communication_logs" ENABLE ROW LEVEL SECURITY;

-- Auto-avbokningsjobbet: hitta kortlösa preliminära billigt.
-- Ligger (som HNSW-indexen och exclusion-constrainten) endast i migrations-SQL.
CREATE INDEX "bookings_pending_cardless_idx" ON "bookings" ("starts_at")
  WHERE "status" = 'PENDING' AND "card_psp_token" IS NULL;
