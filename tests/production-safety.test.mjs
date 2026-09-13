import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(path, 'utf8');

test('number order route requires Idempotency-Key', () => {
  const source = fs.readFileSync('app/api/v1/numbers/route.ts', 'utf8');
  assert.match(source, /Idempotency-Key/);
  assert.match(source, /reserve_number_order/);
});

test('number order route reserves before provider provisioning', () => {
  const source = fs.readFileSync('app/api/v1/numbers/route.ts', 'utf8');
  const reservePos = source.indexOf('reserve_number_order');
  const provisionPos = source.indexOf('providerClient.provisionNumber');
  assert.ok(reservePos >= 0 && provisionPos >= 0 && reservePos < provisionPos);
});

test('number order route rejects invalid provider pricing', () => {
  const source = fs.readFileSync('app/api/v1/numbers/route.ts', 'utf8');
  assert.match(source, /monthlyPrice <= 0/);
  assert.match(source, /monthlyPriceCents/);
});

test('reconciliation endpoint is CRON_SECRET protected', () => {
  const source = fs.readFileSync('app/api/internal/reconciliation/route.ts', 'utf8');
  assert.match(source, /CRON_SECRET/);
  assert.match(source, /Bearer \$\{secret\}/);
});

test('reconciliation never auto-refunds ambiguous missing external ids', () => {
  const source = fs.readFileSync('app/api/internal/reconciliation/route.ts', 'utf8');
  assert.match(source, /outcome is ambiguous/);
  assert.match(source, /manual_reconciliation_required/);
});

test('all public tables are expected to remain RLS protected', () => {
  const migration = fs.readFileSync(
    'supabase/migrations/20260910090537_canonical_schema_20260910_v2.sql',
    'utf8',
  );
  assert.match(migration, /row level security/i);
});

test('webhook signing secret is encrypted at rest and delivery worker is wired', () => {
  const env = read('lib/env.ts');
  const route = read('app/api/v1/webhooks/route.ts');
  const worker = read('services/webhook-delivery.ts');
  const inbound = read('services/inbound-webhook.ts');
  assert.match(env, /WEBHOOK_ENCRYPTION_KEY/);
  assert.match(route, /secret_ciphertext/);
  assert.match(route, /encryptWebhookSecret/);
  assert.match(worker, /aes-256-gcm/);
  assert.match(worker, /x-jyyr-signature/);
  assert.match(worker, /claim_webhook_deliveries/);
  assert.match(inbound, /dispatchWebhookDeliveries/);
});

test('queue migration contains claim locking and duplicate event protection', () => {
  const migration = read('supabase/migrations/20260911200253_inbound_events_and_webhook_queue.sql');
  const queueMigration = read('supabase/migrations/20260911154640_webhook_delivery_secret_ciphertext.sql');
  assert.match(migration, /enqueue_inbound_message_events/);
  assert.match(migration, /notifications/);
  assert.match(queueMigration, /claim_webhook_deliveries/);
  assert.match(queueMigration, /message_events_message_event_type_key/);
  assert.match(queueMigration, /SKIP LOCKED/);
});

test('top-up flow verifies Stripe callback and credits only through trusted RPC', () => {
  const route = read('app/api/webhooks/payment/route.ts');
  const topup = read('app/api/wallet/deposit/route.ts');
  assert.match(route, /stripe-signature/);
  assert.match(route, /credit_wallet_payment/);
  assert.match(topup, /STRIPE_SECRET_KEY/);
  assert.match(topup, /idempotency_key/);
});

test('inbound dispatch claims deliveries atomically', () => {
  const inbound = read('services/inbound-webhook.ts');
  const worker = read('services/webhook-delivery.ts');
  assert.match(inbound, /dispatchWebhookDeliveries/);
  assert.match(worker, /claim_webhook_deliveries_by_ids/);
});

test('admin authorization is server-side', () => {
  const admin = read('services/admin.ts');
  assert.match(admin, /profiles/);
  assert.match(admin, /role/);
  assert.match(admin, /admin/);
});

for (const file of ['lib/env.ts','app/api/billing/topup/route.ts','app/api/webhooks/stripe/route.ts']) {
  test(`${file} does not expose server secrets through NEXT_PUBLIC`, () => {
    assert.doesNotMatch(read(file), /NEXT_PUBLIC_[A-Z_]*(SECRET|TOKEN)/i);
    assert.doesNotMatch(read(file), /NEXT_PUBLIC_SERVICE_ROLE|NEXT_PUBLIC_PROVIDER|NEXT_PUBLIC_STRIPE/i);
  });
}


test('Vercel cron configuration does not duplicate reconciliation scheduling', () => {
  const vercel = read('vercel.json')
  const cronEntries = (vercel.match(/"schedule":/g) || []).length

  assert.equal(cronEntries, 0)
  assert.deepEqual(JSON.parse(vercel), { crons: [] })
});
