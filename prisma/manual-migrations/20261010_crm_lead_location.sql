-- CRM: where a lead is.
--
-- Additive and idempotent. Three nullable columns and one CHECK. Every lead that
-- exists now keeps all three NULL ("not recorded"): nothing is backfilled, and no
-- country is inferred from a phone number, a name, a source or an import.
--
--   "country"  ISO 3166-1 alpha-2 code, upper case. 'IN' is the domestic case.
--   "state"    a state or union territory of India. Only when "country" is 'IN'.
--   "city"     free text: the city or the specific location (at most 100 characters).
--
-- The CHECK is the database's last word on the shape (the service validates the
-- country and state against their lists):
--   - no state or city without a country;
--   - a country is two capital letters;
--   - India needs a state; a state belongs to India only;
--   - city is at most 100 characters.
-- (A comparison with a NULL country is itself NULL, which a CHECK lets through, so
-- the country is tested with IS NOT NULL first.)
-- Because every existing row is NULL the CHECK is satisfied by all of them when it
-- is added, so this migration has no data pre-flight.
--
-- Apply:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f prisma/manual-migrations/20261010_crm_lead_location.sql

BEGIN;

ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "country" TEXT;
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "state" TEXT;
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "city" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Lead_location_shape') THEN
    ALTER TABLE "Lead"
      ADD CONSTRAINT "Lead_location_shape" CHECK (
        ("city" IS NULL OR char_length("city") <= 100)
        AND (
          ("country" IS NULL AND "state" IS NULL AND "city" IS NULL)
          OR (
            "country" IS NOT NULL
            AND "country" ~ '^[A-Z]{2}$'
            AND ("country" <> 'IN' OR "state" IS NOT NULL)
            AND ("country" = 'IN' OR "state" IS NULL)
          )
        )
      );
  END IF;
END
$$;

COMMIT;

-- Rollback (removes the check and the columns; every location entered since is
-- lost, so copy it first if it must be kept):
--
-- BEGIN;
-- ALTER TABLE "Lead" DROP CONSTRAINT IF EXISTS "Lead_location_shape";
-- ALTER TABLE "Lead" DROP COLUMN IF EXISTS "city";
-- ALTER TABLE "Lead" DROP COLUMN IF EXISTS "state";
-- ALTER TABLE "Lead" DROP COLUMN IF EXISTS "country";
-- COMMIT;
--
--   CREATE TABLE "LeadLocation_backup" AS
--     SELECT "id", "country", "state", "city" FROM "Lead" WHERE "country" IS NOT NULL;
