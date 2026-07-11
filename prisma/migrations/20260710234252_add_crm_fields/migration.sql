-- Adminpanelen/CRM: fritext för allergier/upplysningar på kundprofilen,
-- och antal barn i sällskapet på bokningen (visas i widget + dagvyn).
ALTER TABLE "guest_profiles" ADD COLUMN "notes" TEXT;
ALTER TABLE "bookings" ADD COLUMN "children_count" INTEGER NOT NULL DEFAULT 0;
