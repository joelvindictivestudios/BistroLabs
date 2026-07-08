-- Dagvyns "Sitter · X min"-timer: tidpunkten för faktisk incheckning
-- (status → SEATED), inte bokad starttid.
ALTER TABLE "bookings" ADD COLUMN "seated_at" TIMESTAMP(3);
