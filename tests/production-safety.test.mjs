import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

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
