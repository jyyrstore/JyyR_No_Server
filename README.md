# Jyy'R No Server — OTP Activation Marketplace

Existing Next.js + Supabase application evolved into a **one-time OTP activation marketplace**. The project was not rebuilt from zero and the existing authentication, wallet, webhook, provider, admin, and compatibility infrastructure remains in place where useful.

## Product flow

Register/Login → Wallet → Country → Service → Current stock/price → BUY NUMBER → temporary number → WAITING SMS → OTP → SMS_RECEIVED → COMPLETED → history/refund/expiration.

## Canonical architecture

- Next.js 16 App Router / TypeScript
- Supabase Auth + PostgreSQL + RLS + Realtime
- Server-only provider adapters
- Server-authoritative pricing/stock
- PostgreSQL row-locked wallet debit/refund
- Idempotent activation purchase/cancellation/refund/payment webhook
- `orders` as the canonical activation record
- `activation_events` for immutable lifecycle history
- `otp_messages` for inbound SMS
- `wallet_transactions` as the OTP financial ledger

See `ARCHITECTURE.md` for the full dependency flow and `OTP_ACTIVATION_AUDIT.md` for the audit classification.

## OTP provider boundary

The new OTP-specific contract is in `types/otp-provider.ts`, resolved through `services/otp-provider-registry.ts`.

The initial production adapter is **5SIM** because its API is activation/order oriented. Twilio, Telnyx, and Vonage adapters remain in the existing repository for legacy number provisioning compatibility; they are **not** treated as equivalent temporary OTP activation providers.

Production 5SIM remains disabled in the database until real provider credentials and account readiness are configured and verified.

## Environment

Public:
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

Server-only:
- `SUPABASE_SERVICE_ROLE_KEY`
- `CRON_SECRET`
- `APP_BASE_URL`
- `FIVESIM_API_KEY`
- `FIVESIM_CURRENCY`
- `OTP_PROVIDER_FX_RATE` when provider/customer currencies differ
- payment/provider secrets used by existing integrations

Never expose server credentials through `NEXT_PUBLIC_*`.

## Development

Requirements: Node.js 22+ and npm.

```bash
npm ci
npm test
npm run typecheck
npm run lint
npm run build
npm run dev
```

The supplied archive did not contain a complete `node_modules` installation, and this execution environment could not download all npm packages. Therefore typecheck/lint/build are **not claimed verified** from this archive.

## Database

New forward migrations:

- `20260913055900_add_reserving_activation_status.sql`
- `20260913060000_harden_otp_activation_domain.sql`

The production Supabase project was directly verified after applying the schema changes. No production tables were dropped.

Canonical activation states:

`PENDING → RESERVING → WAITING_SMS → SMS_RECEIVED → COMPLETED`

Terminal/exception states:

`FAILED`, `CANCELLED`, `EXPIRED`, `REFUNDED`.

## API

Canonical activation API:

- `GET /api/v1/activations`
- `POST /api/v1/activations` — requires `Idempotency-Key`
- `GET /api/v1/activations/:id`
- `POST /api/v1/activations/:id` with `{ "action": "cancel" }`
- `GET /api/v1/activations/:id/messages`

Compatibility aliases remain:

- `/api/orders`
- `/api/orders/:id`
- `/api/billing/topup`
- `/api/webhooks/stripe`

The aliases contain no duplicate business logic.

## Wallet safety

Purchase sequence:

1. authenticate
2. resolve live offer
3. atomically debit wallet + create `RESERVING` activation
4. acquire upstream activation
5. finalize provider order/number
6. wait for SMS

Definitive provider failure refunds through the existing idempotent refund RPC. Network/timeout outcomes are marked for reconciliation instead of being blindly refunded.

Historical prices are snapshotted as provider cost, markup, sale price, and currency.

## Background reconciliation

`/api/internal/reconciliation` is CRON-secret protected and handles:

- legacy number-order reconciliation
- OTP provider polling
- SMS persistence
- activation completion
- expiration/release/refund
- webhook delivery retries

**Important:** the connected Vercel project is on Hobby. Its current cron schedule is daily, which is not sufficient for a 15-minute OTP expiration SLA. A production deployment needs a more frequent scheduler/worker before claiming real-time expiration guarantees.

## Security

- Customer ownership is checked server-side.
- Financial/lifecycle mutations are server-only.
- Supabase RLS is enabled on wallet, order, message, payment, webhook, and activation-event tables.
- Provider credentials stay server-side.
- Payment webhooks use signature verification and duplicate-event tracking.
- OTP provider outcomes are reconciled server-side.
- No CAPTCHA bypass, anti-fraud bypass, spam tooling, or verification-evasion functionality is implemented.

## Testing

`npm test` currently passes **23/23** source-level production-safety/marketplace tests.

A full live E2E test still requires:

- real OTP provider credentials and funded provider account
- enabled provider country/service mappings
- live payment credentials/webhook
- networked dependency installation
- a real test customer/account

Do not interpret the mock/legacy provider code as live OTP readiness.
