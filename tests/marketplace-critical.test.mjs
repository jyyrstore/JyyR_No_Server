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
