# Jyy'R Virtual Number Marketplace

Jyy'R No Server is an existing Next.js + Supabase foundation evolved into a **virtual/temporary phone-number marketplace for legitimate SMS/OTP workflows**.

## Product flow

Register/Login → Deposit balance → Country → Service → Price/Stock → Buy → Waiting for SMS → OTP → Copy → Cancel/Expire → History.

The old number/API infrastructure remains available where compatibility matters; the marketplace uses its own `countries`, `services`, `provider_*`, `orders`, `otp_messages`, `payments`, `wallets`, and `wallet_transactions` domain.

## Architecture

Next.js App Router → server API/services → Supabase/PostgreSQL + provider adapters.

Financial effects are performed by server-only RPCs with row locking and idempotency. Provider-specific code stays inside adapters. Provider webhook messages are validated, persisted, matched to an active order, and converted into OTP events.

## Development

Requirements: Node.js 22+, npm, Supabase project.

```bash
cp .env.example .env.local
npm install
npm run test
npm run typecheck
npm run lint
npm run build
npm run dev
```

If the checkout environment has no installed dependencies, install may require normal network access. The supplied source archive itself does not contain a complete `node_modules` tree.

## Environment

Public:
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

Server only:
- `SUPABASE_SERVICE_ROLE_KEY`
- `CRON_SECRET`
- `APP_BASE_URL`
- provider credentials (`TWILIO_*`, `TELNYX_*`, `VONAGE_*`)
- Stripe credentials (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`)
- `WEBHOOK_ENCRYPTION_KEY`

Marketplace:
- `OTP_ORDER_TTL_SECONDS`
- `PAYMENT_PROVIDER` = `stripe`, `mock`, or supported implementation
- `PAYMENT_CURRENCY` (default `IDR`)
- `DEMO_MODE`

Never prefix a secret with `NEXT_PUBLIC_`.

## Supabase

The existing production schema is preserved. Marketplace migrations are incremental:

- `20260912100000_marketplace_otp_domain.sql`
- `20260912101500_marketplace_rpc_phone_guard.sql`
- `20260912102000_marketplace_realtime_orders.sql`
- `marketplace_webhook_rls_hardening_20260912`
- `marketplace_order_concurrency_indexes_20260912`

The live project was checked after migration. Existing production data is not dropped.

## Providers

Existing Twilio, Telnyx, Vonage, and custom adapters are preserved. A development-only `mock` adapter provides deterministic test stock.

Production OTP acquisition requires real provider credentials, provider-side SMS capability, and webhook configuration. The mock adapter is not evidence of live provider readiness.

## Payments

The marketplace payment model is:
create payment → gateway checkout → signed webhook → duplicate-event guard → server RPC → wallet ledger.

Stripe is implemented. A `mock` payment mode is available for development. Live payment processing requires valid gateway credentials and webhook configuration.

## API

Marketplace endpoints:

- `GET /api/countries`
- `GET /api/services`
- `GET /api/stock?country_id=...&service_id=...`
- `POST /api/orders`
- `GET /api/orders`
- `GET /api/orders/:id`
- `POST /api/orders/:id` (cancel)
- `GET /api/wallet`
- `POST /api/wallet/deposit`
- `POST /api/webhooks/payment`
- provider webhooks remain at `/api/webhooks/twilio`, `/api/webhooks/telnyx`, `/api/webhooks/vonage`

Errors use `{ success:false, error:{code,message} }` on new marketplace APIs.

## Order lifecycle

`pending → waiting → sms_received → completed`

Terminal alternatives: `cancelled`, `expired`, `refunded`, `failed`.

The browser never owns order status. Server/provider events do.

## Wallet invariants

Every purchase creates one ledger entry. Every refund is keyed by `refund:<order-id>`. Every payment credit is keyed by `payment:<payment-id>`. User wallet rows are locked during financial operations.

## Realtime

Order detail subscribes to Supabase Realtime `orders` updates and also has a conservative polling fallback.

## Expiration

Vercel Hobby-safe deployment keeps one cron endpoint: `/api/internal/reconciliation`. It handles existing reconciliation, marketplace expiration/release/refund, and webhook delivery retries.

## Admin

Existing server-side admin authorization and admin infrastructure are preserved. Marketplace catalog tables are ready for country/service/provider/pricing management; admin UI expansion should be enabled only against the final production catalog policy.

## Testing

```bash
npm test
```

Critical source-level tests cover idempotency, authoritative pricing, active-number uniqueness, signed payment webhook/replay protection, and expiration/refund wiring.

A complete live E2E test additionally requires real provider/payment credentials. Do not treat mock success as production verification.

## Production checklist

- [ ] Configure real OTP provider credentials.
- [ ] Configure provider SMS webhook URLs and signatures.
- [ ] Configure live payment gateway + signed webhook.
- [ ] Verify Supabase Auth email/redirect settings.
- [ ] Enable leaked-password protection in Supabase Auth.
- [ ] Review Supabase security/performance advisors.
- [ ] Run lint, typecheck, test, and build in a networked CI environment.
- [ ] Perform a real deposit → purchase → SMS → cancel/expire E2E test.
- [ ] Monitor provider failures, reconciliation, refunds, and webhook queues.

## Safety

This project is intended for legitimate communications and verification workflows. It does not implement CAPTCHA/OTP bypassing, fraud-control bypasses, credential abuse, or evasion of platform security controls.
