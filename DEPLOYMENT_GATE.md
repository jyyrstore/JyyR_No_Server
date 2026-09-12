# Jyy'R Number Server — Deployment Gate

## Confirmed
- Supabase production project remains `yvegoaxaincfcylfpbtu`; migrations are forward-only.
- RLS remains enabled on application tables.
- Order reservation remains balance-locked and idempotent.
- Webhook deliveries use atomic claim with `FOR UPDATE SKIP LOCKED`.
- Inbound events feed messages, notifications, and webhook delivery queue.
- Wallet top-up credit is server-side and Stripe-callback gated.
- No server secret is prefixed `NEXT_PUBLIC_`.

## Vercel Hobby operating model
Native Vercel Cron is intentionally kept daily. Vercel documentation states Hobby cron is once per day, while Pro/Enterprise supports once-per-minute precision. Immediate `sms.received` webhook delivery is attempted inline; retry worker should be called by an external scheduler for sub-hour retry guarantees.

## Required production variables
`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `API_RATE_LIMIT_PER_MINUTE`, `CRON_SECRET`, `WEBHOOK_ENCRYPTION_KEY`, `APP_BASE_URL`, provider credentials, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`.

## Final verification gate
Run `npm ci`, `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`, deploy to a preview, smoke-test `/api/health`, then production-smoke the real provider and Stripe webhooks.
