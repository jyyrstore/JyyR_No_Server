# Supabase schema / migration

`migrations/20260910_000001_canonical_schema.sql` is the canonical database baseline for Jyy'R Number Server.

It is intentionally idempotent for an already-provisioned project and also contains enough DDL to build a fresh database with the same application schema.

## Important

The live Supabase project already contains application tables. Do not run an older `001_initial.sql` from an earlier ZIP. Use this canonical migration instead.

After applying it, run `VERIFY_SCHEMA.sql` and expect the canonical application object counts to remain stable.

Secrets and provider credentials are never stored in this migration.
