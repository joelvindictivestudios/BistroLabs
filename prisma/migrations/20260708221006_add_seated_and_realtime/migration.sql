-- BLA-31: SEATED-status (check-in) + Supabase Realtime på bookings.
--
-- OBS: RLS-policyn och publication-raden kan inte uttryckas i Prisma-schemat —
-- kör ALDRIG prisma db push (droppar/missar dem tyst).
--
-- RLS-notering: Prisma ansluter som `postgres` (tabellägare) och bypassar RLS.
-- Slå ALDRIG på FORCE ROW LEVEL SECURITY på bookings — då bryts appens writes.
-- Policyn styr vad Supabase Realtime/PostgREST (authenticated-rollen) får läsa.

ALTER TYPE "BookingStatus" ADD VALUE 'SEATED';

ALTER TABLE "bookings" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "owner_reads_own_bookings" ON "bookings"
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM "restaurants" r
      WHERE r."id" = "bookings"."restaurant_id" AND r."owner_id" = auth.uid()
    )
  );

ALTER PUBLICATION supabase_realtime ADD TABLE "bookings";
