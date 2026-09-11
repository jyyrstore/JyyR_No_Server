# Production audit result — 2026-09-11

## Supabase
- RLS: enabled on all 18 public application tables.
- anon: no SELECT/INSERT/UPDATE/DELETE grants remain.
- authenticated: grants now match the intended RLS client operations.
- SECURITY DEFINER billing functions: execute restricted to service_role; fixed search_path is `public, pg_temp`.
- API rate-limit storage: service_role only; rate-limit RPC restricted to service_role.
- number_orders: positive-price constraint, unique `(user_id,idempotency_key)`, billing reservation before provider purchase, and idempotency serialization now enforced.
- Security Advisor: only remaining warning is Supabase Auth Leaked Password Protection disabled.
- Performance Advisor: 18 unused-index INFO findings; no indexes removed because the database is new and several are required for FK/RLS/worker paths.

## Reconciliation
The included endpoint is protected by `CRON_SECRET`, processes stale orders in bounded batches, completes orders whose DB phone row exists, refunds stale pre-provision reservations, releases known orphaned provider numbers before refunding, and never automatically refunds ambiguous cases with a missing provider external id.

## Automated tests
`npm test` uses Node's built-in test runner and verifies the critical source-level invariants without adding a test dependency.
