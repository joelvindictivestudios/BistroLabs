-- Bokningar: incheckat antal, personalanteckning, allergifält (gallras vid
-- COMPLETED), samtyckeslogg samt utskicksstämplar för bekräftelse/påminnelse.
ALTER TABLE "bookings" ADD COLUMN     "allergy_consent_at" TIMESTAMP(3),
ADD COLUMN     "allergy_consent_text" TEXT,
ADD COLUMN     "allergy_note" TEXT,
ADD COLUMN     "arrived_count" INTEGER,
ADD COLUMN     "confirmation_sent_at" TIMESTAMP(3),
ADD COLUMN     "reminder_sent_at" TIMESTAMP(3),
ADD COLUMN     "staff_note" TEXT;

-- AI-inkorgen: "Jag tar den själv" — exkluderas ur väntande-räknaren.
ALTER TABLE "email_messages" ADD COLUMN "handled_at" TIMESTAMP(3);

-- Kundprofil: marknadsföringssamtycke (19 § MFL) med tidsstämpel.
ALTER TABLE "guest_profiles" ADD COLUMN     "marketing_consent" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "marketing_consent_at" TIMESTAMP(3);

-- Påminnelsejobbet: hitta oskickade kommande bokningar billigt.
-- Ligger (som HNSW-indexen och exclusion-constrainten) endast i migrations-SQL.
CREATE INDEX "bookings_reminder_pending_idx" ON "bookings" ("starts_at")
  WHERE "reminder_sent_at" IS NULL;
