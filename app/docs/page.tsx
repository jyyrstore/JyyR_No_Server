import { AppShell } from '@/components/app-shell';
export default function Docs(){return <AppShell><p className="text-sm muted">Developer platform</p><h1 className="mt-1 text-3xl font-black">API Documentation</h1><div className="mt-6 grid gap-4 lg:grid-cols-2">{[['Authentication','Send x-api-key. Keys are hashed at rest and shown once.'],['Numbers','GET /api/v1/numbers/available and POST /api/v1/numbers. Purchase requests require Idempotency-Key.'],['Messages','GET /api/v1/messages. Access is scoped to the API key owner.'],['Webhooks','POST /api/v1/webhooks. Deliveries use HMAC-SHA256 with timestamp.body.'],['Errors','{ error: { code, message, request_id } } with standard HTTP status semantics.'],['Rate limits','Default 100 requests/minute per API key. 429 includes a request ID.']].map(([a,b])=><div className="glass rounded-2xl p-6" key={a}><div className="font-bold">{a}</div><p className="mt-2 text-sm muted">{b}</p></div>)}</div><pre className="glass mt-5 overflow-auto rounded-2xl p-6 text-sm">{`curl https://jyyrnoserver.vercel.app/api/v1/numbers/available?country=US \
  -H "x-api-key: jyr_live_..."

curl -X POST https://jyyrnoserver.vercel.app/api/v1/numbers \
  -H "x-api-key: jyr_live_..." \
  -H "Idempotency-Key: unique-request-123" \
  -H "content-type: application/json" \
  -d '{"provider":"twilio","phoneNumber":"+15551234567","countryCode":"US"}'`}</pre></AppShell>}
