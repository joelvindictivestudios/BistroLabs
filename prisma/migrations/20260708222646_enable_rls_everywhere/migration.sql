-- SÄKERHET: Supabase ger PostgREST-rollerna (anon/authenticated) default-grants
-- på alla public-tabeller — utan RLS var därmed gäster, bokningar, kunskap m.m.
-- fritt läsbara med den publika anon-nyckeln. RLS PÅ överallt: inga policyer =
-- allt nekas för anon/authenticated. Appen påverkas inte (Prisma ansluter som
-- postgres = tabellägare och bypassar RLS — slå ALDRIG på FORCE RLS).
-- bookings behåller sin owner-select-policy (Supabase Realtime i dagvyn).

ALTER TABLE "restaurants" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "rooms" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tables" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "guests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "guest_profiles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "guest_interactions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "knowledge_documents" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "email_threads" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "email_messages" ENABLE ROW LEVEL SECURITY;
