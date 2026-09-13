# OTP Activation Marketplace Architecture

## Canonical flow
`Authenticated customer -> marketplace catalog -> server price/stock revalidation -> reserve+debit RPC -> OTP provider -> finalize activation -> provider polling/webhook -> otp_messages -> activation status -> customer realtime/polling -> expiry/cancel -> provider release -> idempotent refund`

The existing Next.js + Supabase application remains the system foundation. `orders` is the current canonical activation record; legacy `number_orders` and `transactions` remain only for compatibility and are not used by the OTP purchase path.

## Financial invariant
The purchase endpoint does not trust client price or provider number selection. It resolves the current provider offer, snapshots provider cost/markup/sale price, then atomically debits the wallet and creates a `reserving` activation. Provider acquisition occurs after the debit. Definitive provider failure refunds through the existing idempotent `refund_market_order` RPC. Network/timeout outcomes are left for reconciliation rather than automatically refunded.

## Provider boundary
`types/otp-provider.ts` defines the OTP-specific provider contract. `services/otp-provider-registry.ts` resolves production OTP adapters. The initial adapter is `providers/5sim`. Twilio/Telnyx/Vonage adapters are retained for the legacy number-server compatibility surface because their existing APIs are number provisioning APIs, not equivalent OTP activation/order APIs.

## State
`PENDING -> RESERVING -> WAITING_SMS -> SMS_RECEIVED -> COMPLETED`

Terminal/exception states: `FAILED`, `CANCELLED`, `EXPIRED`, `REFUNDED`.

Lifecycle events are recorded in `activation_events`; customer access is constrained by RLS.

## Background processing
Vercel cron calls the reconciliation endpoint. It reconciles legacy number orders, polls OTP activations, processes expiry/release/refund, and dispatches queued outbound webhooks. The job is bounded and idempotent; the browser is never the source of truth for expiration or provider state.

## Security
Browser code uses Supabase publishable/anon credentials only. Server-side provider/payment credentials are environment variables and never use `NEXT_PUBLIC_*`. Customer authorization is enforced by authenticated user ownership in server routes; direct database mutations of financial and lifecycle records are restricted from authenticated clients by grants/RLS.
