-- Bookings-policyn (owner_reads_own_bookings) gör EXISTS mot restaurants som
-- authenticated-rollen — den subqueryn kräver att ägaren får SELECT:a sin egen
-- restaurangrad, annars blir bookings-läsning och Realtime-events tomma.
CREATE POLICY "owner_reads_own_restaurants" ON "restaurants"
  FOR SELECT TO authenticated
  USING ("owner_id" = auth.uid());
