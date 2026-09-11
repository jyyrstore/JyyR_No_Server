BEGIN;

-- Historical reconciliation migration.
-- Production already contains this migration version. Webhook secret
-- encryption, delivery queue locking, and worker wiring are represented
-- by the idempotent source migrations in this folder.

COMMIT;
