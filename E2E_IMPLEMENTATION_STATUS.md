# Jyy'R Number Server — E2E Implementation Status

## Implemented in this package

- Webhook signing secret encryption at rest (`AES-256-GCM`).
- Durable webhook delivery payloads.
- Inbound SMS event creation (`sms.received`).
- User notification creation for inbound SMS.
- Immediate outbound webhook delivery after inbound persistence.
- Durable retry queue with DB-side claim locking (`FOR UPDATE SKIP LOCKED`).
- Delivery signatures and request metadata.
- Retry backoff with terminal failure.
- Realtime publication for `message_events`.
- Duplicate protection for one logical message event.
- Reconciliation endpoint also processes due webhook deliveries.
- Live database migration included for the current queue hardening.

## Required server environment

Set `WEBHOOK_ENCRYPTION_KEY` to a strong random secret (prefer a base64-encoded 32-byte value).

Existing provider credentials remain server-only. Do not put provider secrets, Supabase service-role keys, or webhook encryption keys in `NEXT_PUBLIC_*` variables.

## Verification boundary

Static/source checks can be prepared in this package, but a real inbound SMS E2E requires one real provider number and valid provider credentials. No provider purchase is performed by this package.

The database-side changes were also applied to the connected production Supabase project during this session. Keep the migration files in sync before using `supabase db push`.
