BEGIN;

-- Historical reconciliation migration.
-- Production already contains this migration version. The effective
-- webhook-queue objects are represented idempotently by the adjacent
-- source migrations so a clean local rebuild reaches the same schema.

COMMIT;
