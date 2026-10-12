-- FinanceOS: one receipt per payment collection, with unique numbers.
--
-- Additive and idempotent. No existing row is changed: receipts that exist keep
-- their numbers (RCPT-...); new receipts are numbered RC/<FY>/<sequence> by the
-- application. Before anything is created the script checks that the existing
-- data satisfies the new rules and stops, changing nothing, if it does not.
--
--   - "ReceiptVoucher"."paymentCollectionId" references "PaymentCollection"
--     (ON DELETE RESTRICT) and is unique: one receipt per payment.
--   - "ReceiptVoucher"."receiptNumber" is unique when present.
--
-- Data only in the sense of constraints: no permission is added (generating
-- needs the existing collections.record, reading collections.view).
--
-- Apply:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f prisma/manual-migrations/20261015_receipt_voucher_governance.sql

BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "ReceiptVoucher" r
    WHERE NOT EXISTS (SELECT 1 FROM "PaymentCollection" p WHERE p."id" = r."paymentCollectionId")
  ) THEN
    RAISE EXCEPTION 'Cannot link receipts to payments: a receipt names a payment collection that does not exist.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM "ReceiptVoucher" GROUP BY "paymentCollectionId" HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Cannot allow one receipt per payment: a payment collection already has more than one receipt.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM "ReceiptVoucher" WHERE "receiptNumber" IS NOT NULL
    GROUP BY "receiptNumber" HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Cannot require unique receipt numbers: two receipts share a number.';
  END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS "ReceiptVoucher_paymentCollectionId_key"
  ON "ReceiptVoucher" ("paymentCollectionId");

CREATE UNIQUE INDEX IF NOT EXISTS "ReceiptVoucher_receiptNumber_key"
  ON "ReceiptVoucher" ("receiptNumber");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ReceiptVoucher_paymentCollectionId_fkey'
  ) THEN
    ALTER TABLE "ReceiptVoucher"
      ADD CONSTRAINT "ReceiptVoucher_paymentCollectionId_fkey"
      FOREIGN KEY ("paymentCollectionId") REFERENCES "PaymentCollection" ("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END
$$;

COMMIT;

-- Rollback (removes the constraints only; receipts are kept):
--
-- BEGIN;
-- ALTER TABLE "ReceiptVoucher" DROP CONSTRAINT IF EXISTS "ReceiptVoucher_paymentCollectionId_fkey";
-- DROP INDEX IF EXISTS "ReceiptVoucher_receiptNumber_key";
-- DROP INDEX IF EXISTS "ReceiptVoucher_paymentCollectionId_key";
-- COMMIT;
