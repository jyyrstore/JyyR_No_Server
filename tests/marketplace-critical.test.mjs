import { readFileSync } from 'node:fs'
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const rpc=fs.readFileSync('supabase/migrations/20260913060000_harden_otp_activation_domain.sql','utf8');
const migration=fs.readFileSync('supabase/migrations/20260912100000_marketplace_otp_domain.sql','utf8');
const orderRoute=fs.readFileSync('app/api/v1/activations/route.ts','utf8');
const payment=fs.readFileSync('app/api/webhooks/payment/route.ts','utf8');

test('market order schema has required lifecycle and ownership fields',()=>{
 for(const x of ['user_id','provider_id','country_id','service_id','phone_number','price_cents','status','otp_code','expires_at','idempotency_key']) assert.match(migration,new RegExp(x));
 for(const x of ['pending','waiting','sms_received','completed','cancelled','expired','refunded','failed']) assert.match(migration,new RegExp(x));
});
test('purchase requires idempotency and authoritative database pricing',()=>{
 assert.match(orderRoute,/Idempotency-Key/); assert.match(orderRoute,/resolveOtpOffer/); assert.match(orderRoute,/reserve_market_activation/); assert.match(rpc,/p_price_cents/);
 assert.match(rpc,/reserve_market_activation/); assert.match(rpc,/for update/);
});
test('same provider number cannot have two active marketplace orders',()=>{
 assert.match(fs.readFileSync('supabase/migrations/20260912100000_marketplace_otp_domain.sql','utf8'),/status public\.market_order_status/);
 assert.match(fs.readFileSync('supabase/migrations/20260913060000_harden_otp_activation_domain.sql','utf8'),/uq_market_orders_active_provider_phone/);
});
test('payment webhook has signature and duplicate-event guard before credit',()=>{
 assert.match(payment,/verifyStripe/); assert.match(payment,/webhook_events/); assert.match(payment,/23505/); assert.match(payment,/credit_wallet_payment/);
});
test('expiration worker releases then refunds through idempotent RPC',()=>{
 const src=fs.readFileSync('app/api/internal/reconciliation/route.ts','utf8');
 assert.match(src,/expires_at/); assert.match(src,/releaseNumber/); assert.match(src,/refund_market_order/);
});


const guards=fs.readFileSync('supabase/migrations/20260912103000_marketplace_transaction_guards.sql','utf8');
const canonical=fs.readFileSync('supabase/migrations/20260913060000_harden_otp_activation_domain.sql','utf8');

test('active provider number reservation is database protected against races',()=>{
  assert.match(guards,/create unique index if not exists uq_market_orders_active_provider_phone/);
  assert.match(guards,/where status in \('pending','waiting','sms_received'\)/);
  assert.match(guards,/pg_advisory_xact_lock/);
  assert.match(guards,/when unique_violation/);
  assert.match(guards,/number_not_available/);
});

test('refund cannot mint balance for an order that was never charged',()=>{
  assert.match(guards,/v_charged boolean/);
  assert.match(guards,/type='otp_purchase'/);
  assert.match(guards,/wt\.amount_cents<0/);
  assert.match(guards,/if not v_charged then/);
});

test('payment webhook retries failed wallet credits instead of marking processed',()=>{
  assert.match(payment,/creditError/);
  assert.match(payment,/!result\?\.ok/);
  assert.match(payment,/status:'failed'/);
  assert.match(payment,/status==='processed'/);
  assert.match(payment,/\.insert\(\{/);
  assert.match(payment,/\.code==='23505'/);
  assert.match(payment,/\.eq\('source','stripe'\)/);
  assert.match(payment,/\.eq\('event_id',event\.id\)/);
});

test('reconciliation is delegated to GitHub Actions, not Vercel Cron', () => {
  const vercel = readFileSync('vercel.json', 'utf8')
  const workflow = readFileSync('.github/workflows/reconciliation.yml', 'utf8')

  assert.deepEqual(JSON.parse(vercel), { crons: [] })
  assert.match(workflow, /schedule:/)
  assert.match(workflow, /cron:/)
  assert.match(workflow, /CRON_SECRET/)
});

test('reserving activation without provider order id is never blindly auto-refunded on expiry',()=>{
  const src=fs.readFileSync('app/api/internal/reconciliation/route.ts','utf8');

  assert.match(src,/findRecentActivations/);
  assert.match(src,/RECONCILIATION_REQUIRED/);
  assert.match(src,/No deterministic 5SIM activation match found/);
  assert.match(src,/Multiple possible 5SIM activations matched reservation/);
});

test('provider attempt timestamp is captured before external OTP purchase',()=>{
  const src=fs.readFileSync('app/api/v1/activations/route.ts','utf8');

  assert.match(src,/provider_attempt_at: new Date\(\)\.toISOString\(\)/);
  assert.match(src,/\.eq\('status', 'reserving'\)/);
});

test('5SIM provider exposes activation history recovery',()=>{
  const provider=fs.readFileSync('types/otp-provider.ts','utf8');
  const adapter=fs.readFileSync('providers/5sim/index.ts','utf8');

  assert.match(provider,/OtpProviderActivationCandidate/);
  assert.match(provider,/findRecentActivations/);
  assert.match(adapter,/\/user\/orders\?category=activation/);
  assert.match(adapter,/5sim_order_history/);
});

test('response-loss recovery requires exact-one provider match',()=>{
  const src=fs.readFileSync('app/api/internal/reconciliation/route.ts','utf8');

  assert.match(src,/findRecentActivations/);
  assert.match(src,/matching\.length === 1/);
  assert.match(src,/candidate\.priceCents/);
  assert.match(src,/provider_cost_cents/);
  assert.match(src,/Math\.abs\(/);
  assert.match(src,/120_000/);
  assert.match(src,/finalize_market_activation/);
  assert.match(src,/No deterministic 5SIM activation match found/);
  assert.match(src,/Multiple possible 5SIM activations matched reservation/);
  assert.match(src,/RECONCILIATION_REQUIRED/);
});

test('ambiguous response-loss never auto-refunds or chooses arbitrary candidate',()=>{
  const src=fs.readFileSync('app/api/internal/reconciliation/route.ts','utf8');

  assert.match(src,/matching\.length === 1/);
  assert.match(src,/matching\.length === 0/);
  assert.match(src,/Multiple possible 5SIM activations matched reservation/);
  assert.match(src,/finalize_market_activation/);
});


test('generic legacy expiry never owns the 5sim OTP lifecycle',()=>{
  const src=fs.readFileSync(
    'app/api/internal/reconciliation/route.ts',
    'utf8'
  );

  assert.match(src,/p\?\.slug === '5sim'/);
  assert.match(
    src,
    /OTP\/5SIM orders have their own provider-aware lifecycle/
  );
});

test('OTP expiry uses provider cancellation before refund',()=>{
  const src=fs.readFileSync(
    'app/api/internal/reconciliation/route.ts',
    'utf8'
  );

  assert.match(src,/claim_activation_expiration/);
  assert.match(src,/cancelActivation/);
  assert.match(src,/Provider cancellation failed/);
  assert.match(src,/RECONCILIATION_REQUIRED/);
});

test('ambiguous cancellation cannot refund',()=>{
  const src=fs.readFileSync(
    'app/api/v1/activations/[id]/route.ts',
    'utf8'
  );

  assert.match(src,/Provider order id missing/);
  assert.match(src,/RECONCILIATION_REQUIRED/);
  assert.match(src,/finalize_activation_cancellation/);
});

test('refund checks existing refund ledger before wallet increment',()=>{
  const src=fs.readFileSync(
    'supabase/migrations/20260913080000_harden_otp_reconciliation_refund_lifecycle.sql',
    'utf8'
  );

  const fn=src.match(
    /create or replace function public\.refund_market_order[\s\S]*?\$\$;/
  );

  assert.ok(fn);

  const existing=fn[0].indexOf('if v_refund_exists then');
  const increment=fn[0].indexOf(
    'set balance_cents=balance_cents+v_order.price_cents'
  );

  assert.ok(existing >= 0);
  assert.ok(increment >= 0);
  assert.ok(existing < increment);
});

test('cancellation is row-lock serialized',()=>{
  const src=fs.readFileSync(
    'supabase/migrations/20260913080000_harden_otp_reconciliation_refund_lifecycle.sql',
    'utf8'
  );

  const fn=src.match(
    /create or replace function public\.claim_activation_cancellation[\s\S]*?\$\$;/
  );

  assert.ok(fn);
  assert.match(fn[0],/for update/);
  assert.match(fn[0],/cancel_started_at/);
});

test('reconciliation expiration is row-lock serialized',()=>{
  const src=fs.readFileSync(
    'supabase/migrations/20260913080000_harden_otp_reconciliation_refund_lifecycle.sql',
    'utf8'
  );

  const fn=src.match(
    /create or replace function public\.claim_activation_expiration[\s\S]*?\$\$;/
  );

  assert.ok(fn);
  assert.match(fn[0],/for update/);
  assert.match(fn[0],/expiration_started_at/);
});

test('duplicate Vercel reconciliation cron is removed',()=>{
  const src=fs.readFileSync('vercel.json','utf8');
  assert.match(src,/"crons": \[\]/);
});

test('provider acquisition success cannot fall through to blind local refund', () => {
  const source = readFileSync('app/api/v1/activations/route.ts', 'utf8')

  assert.match(source, /let providerAcquired = false/)
  assert.match(source, /providerAcquired = true/)
  assert.match(
    source,
    /if \(providerAcquired \|\| uncertain\)/,
  )
  assert.match(source, /RECONCILIATION_REQUIRED/)
})

test('active cancellation requires a provider order id', () => {
  const source = readFileSync(
    'app/api/v1/activations/[id]/route.ts',
    'utf8',
  )

  assert.match(
    source,
    /\['reserving', 'waiting', 'sms_received'\]\.includes\(current\.status\)/,
  )
  assert.match(source, /if \(!c\.provider_order_id\)/)
  assert.match(source, /RECONCILIATION_REQUIRED/)
})

test('expiration claim refuses an active cancellation lease', () => {
  const migration = readFileSync(
    'supabase/migrations/20260913080000_harden_otp_reconciliation_refund_lifecycle.sql',
    'utf8',
  )

  assert.match(
    migration,
    /v_order\.cancel_started_at is not null/,
  )
  assert.match(
    migration,
    /'already_processing'/,
  )
})

test('client profile updates cannot change authoritative role or balance fields', () => {
  const migration = readFileSync(
    'supabase/migrations/20260913080000_harden_otp_reconciliation_refund_lifecycle.sql',
    'utf8',
  )

  assert.match(
    migration,
    /profile role is server-authoritative/,
  )
  assert.match(
    migration,
    /profile balance is server-authoritative/,
  )
  assert.match(
    migration,
    /drop policy if exists profiles_update_own/,
  )
})
