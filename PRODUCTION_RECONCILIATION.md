# Jyy'R Number Server — Production Reconciliation

## Verified production state

- Supabase project: `Jyy'R No Server`
- PostgreSQL: 17.6.1.166
- Production health: `ACTIVE_HEALTHY`
- Webhook claim function kept: `claim_webhook_deliveries(text, integer)`
- Legacy overload `claim_webhook_deliveries(integer, text)`: removed
- Redundant index `idx_webhook_deliveries_retry_queue`: removed
- Canonical queue index retained: `idx_webhook_deliveries_claim_queue`

## Migration history note

Production contains versions `20260911200236`, `20260911200253`, and `20260911202425` whose historical migration names/content were not all preserved in the local source archive. The local source includes idempotent reconciliation placeholders for the two versions whose exact historical SQL was unavailable, while the effective schema changes are represented by the other source migrations.

This is intentionally not a claim of byte-for-byte historical migration fidelity. It is a safe source reconstruction for a clean rebuild plus production migration-history alignment by version.

## Security advisor exceptions

1. `pg_net` is installed in `public`. Moving a managed extension was not performed automatically because it can disrupt extension-owned objects and functions.
2. Supabase Auth leaked-password protection remains disabled. This is an Auth configuration setting, not an application-schema defect.

## Performance advisor

The current database is effectively empty for operational workload, so unused-index notices are expected. They should be reassessed after real traffic before dropping supporting indexes.
