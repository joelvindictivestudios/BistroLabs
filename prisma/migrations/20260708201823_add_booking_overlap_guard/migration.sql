-- BLA-10: dubbelbokningsskydd på databasnivå. Exclusion constraint garanterar
-- att två icke-avbokade bokningar aldrig kan överlappa på samma bord — oavsett
-- kodväg (widget, agenter, dashboard). Ersätter check-then-insert-racen i
-- lib/booking/availability.ts som enda skydd.
--
-- OBS: kan inte uttryckas i Prisma-schemat (lever bara här, precis som
-- HNSW-indexen) — kör ALDRIG prisma db push, den droppar den tyst.

-- btree_gist krävs för att blanda likhet (table_id) med range-överlapp i GiST
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE "bookings"
  ADD CONSTRAINT "bookings_no_overlap"
  EXCLUDE USING gist (
    "table_id" WITH =,
    tsrange("starts_at", "ends_at") WITH &&
  )
  WHERE ("status" NOT IN ('CANCELLED', 'NO_SHOW') AND "table_id" IS NOT NULL);
