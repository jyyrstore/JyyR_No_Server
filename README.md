# Jyy'R Number Server

**Virtual Numbers • Inbound SMS • API Infrastructure**

A secure Next.js + Supabase foundation for legitimate DID numbers, inbound SMS, webhooks, API keys, billing, and provider integrations.

## Stack

- Next.js 16.3.4 / React 19.2.8
- TypeScript 5.9.2
- Tailwind CSS 4.3.3
- Supabase SSR 0.12.7 / Supabase JS 2.116.0
- Zod 4.5.4
- Node.js 22+

## Run locally

```bash
cp .env.example .env.local
npm install
npm run typecheck
npm run lint
npm run build
npm run dev
```

## Security rules

Secrets stay server-side. Never expose service-role keys, provider tokens, database credentials, webhook signing secrets, or similar credentials through `NEXT_PUBLIC_*` variables or browser bundles.

The project is designed for legitimate provider integrations and explicitly does not implement CAPTCHA/OTP bypassing, anti-abuse bypasses, fraud controls bypasses, or account/credential abuse.

## Supabase

The canonical schema and hardening migrations are in `supabase/migrations/`. Do not run the old `001_initial.sql`. The live Supabase project is already migrated.
