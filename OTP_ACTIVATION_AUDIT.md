# OTP Activation Audit

## Status
**LIKELY PRODUCTION-CAPABLE FOUNDATION, NOT YET VERIFIED LIVE.** The repository already contained a substantial OTP marketplace layer, but the purchase path had a critical financial ordering flaw: wallet debit happened during finalization after provider acquisition. The new activation path changes this to reserve+debit before provider acquisition and uses compensation/reconciliation for external failures.

## Classification
- **KEEP:** Next.js App Router, Supabase Auth, profiles, wallet, `otp_messages`, existing customer UI shell.
- **ADAPT:** `orders` as canonical activation record; provider mappings; wallet accounting; marketplace UI.
- **REFACTOR:** provider boundary; purchase consistency; lifecycle events; stock/pricing resolution.
- **DEPRECATE:** `number_orders`, legacy `transactions`, monthly-number APIs, mock provider in production registry.
- **REMOVE later:** duplicate legacy Stripe webhook path and obsolete monthly-number customer screens after consumers are migrated.

## Provider capability matrix
| Provider | Temporary OTP activation/order | Incoming SMS | Cancellation/release | Decision |
|---|---|---|---|---|
| 5SIM | Yes, activation-order API | Yes, status/check response | Yes | Initial OTP provider |
| Twilio | Number provisioning API | Yes | Number release | Not equivalent to OTP activation |
| Telnyx | Number order API | Yes | Number release | Not equivalent to OTP activation |
| Vonage | Number buy/cancel API | Yes | Number cancel | Not equivalent to OTP activation |

No provider is claimed live-ready until credentials, balance, country/service availability, and a real transaction are verified.

## Confirmed findings
- Supabase production is PostgreSQL 17.6.
- All public base tables currently have RLS enabled.
- Vercel project `jyyrnoserver` exists and its latest production deployment is READY.
- Historical Vercel runtime errors include invalid/missing Supabase environment configuration.
- Existing repository tests pass (23/23).
- The supplied archive's dependency tree is incomplete; local typecheck/build therefore cannot currently be independently reproduced until dependencies are installed.
- Legacy monthly-number schema/API remains in the project.
- Provider stock failures were previously swallowed, and the old purchase path acquired a provider number before charging the wallet.

## Verification boundary
Live provider acquisition, live SMS receipt, payment settlement, and full customer E2E cannot honestly be marked verified without production provider/payment credentials and a real test account/stock.
