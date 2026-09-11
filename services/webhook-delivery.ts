import crypto from 'node:crypto';
import { createAdminClient } from '@/lib/supabase-admin';
import { serverEnv } from '@/lib/env';

type DeliveryRow = {
  id: string;
  webhook_id: string;
  event: string;
  request_id: string;
  attempt: number;
  status: 'pending' | 'delivered' | 'failed';
  response_code: number | null;
  latency_ms: number | null;
  response_excerpt: string | null;
  created_at: string;
  next_retry_at: string | null;
  payload: Record<string, unknown>;
  locked_at: string | null;
  locked_by: string | null;
};

type RetryPolicy = {
  max_attempts: number;
  backoff_seconds: number[];
};

function keyBytes(): Buffer {
  const configured = serverEnv().WEBHOOK_ENCRYPTION_KEY;
  if (!configured) throw new Error('WEBHOOK_ENCRYPTION_KEY is not configured');
  // Prefer a base64-encoded 32-byte secret, while accepting an arbitrary
  // configured value by deriving a stable 256-bit key from SHA-256.
  try {
    const decoded = Buffer.from(configured, 'base64');
    if (decoded.length === 32 && /^[A-Za-z0-9+/]+={0,2}$/.test(configured)) return decoded;
  } catch {
    // Fall through to deterministic key derivation.
  }
  return crypto.createHash('sha256').update(configured, 'utf8').digest();
}

export function encryptWebhookSecret(secret: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', keyBytes(), iv);
  const ciphertext = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('base64url')}:${tag.toString('base64url')}:${ciphertext.toString('base64url')}`;
}

export function decryptWebhookSecret(ciphertext: string): string {
  const [version, ivText, tagText, dataText] = ciphertext.split(':');
  if (version !== 'v1' || !ivText || !tagText || !dataText) {
    throw new Error('Invalid webhook secret ciphertext');
  }
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    keyBytes(),
    Buffer.from(ivText, 'base64url'),
  );
  decipher.setAuthTag(Buffer.from(tagText, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(dataText, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}

function retryPolicy(value: unknown): RetryPolicy {
  const fallback: RetryPolicy = {
    max_attempts: 5,
    backoff_seconds: [30, 120, 600, 1800],
  };
  if (!value || typeof value !== 'object') return fallback;
  const raw = value as Record<string, unknown>;
  const max = Number(raw.max_attempts);
  const backoff = Array.isArray(raw.backoff_seconds)
    ? raw.backoff_seconds.map(Number).filter((n) => Number.isFinite(n) && n >= 0)
    : [];
  return {
    max_attempts: Number.isInteger(max) && max >= 1 && max <= 20 ? max : fallback.max_attempts,
    backoff_seconds: backoff.length ? backoff.slice(0, 19) : fallback.backoff_seconds,
  };
}

function sign(secret: string, timestamp: string, body: string): string {
  return crypto.createHmac('sha256', secret).update(`${timestamp}.${body}`, 'utf8').digest('hex');
}

function safeExcerpt(value: string): string {
  return value.replace(/\s+/g, ' ').slice(0, 500);
}

async function deliverRow(row: DeliveryRow, webhook: {
  endpoint_url: string;
  secret_ciphertext: string | null;
  retry_policy: unknown;
}) {
  const admin = createAdminClient();
  const secret = webhook.secret_ciphertext
    ? decryptWebhookSecret(webhook.secret_ciphertext)
    : null;

  if (!secret) {
    await admin
      .from('webhook_deliveries')
      .update({
        status: 'failed',
        response_excerpt: 'Webhook signing secret is unavailable',
        next_retry_at: null,
        locked_at: null,
        locked_by: null,
      })
      .eq('id', row.id);
    return { ok: false, terminal: true };
  }

  const body = JSON.stringify(row.payload);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const started = Date.now();

  try {
    const response = await fetch(webhook.endpoint_url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'user-agent': 'JyyR-Number-Server-Webhook/1.0',
        'x-jyyr-event': row.event,
        'x-jyyr-delivery': row.id,
        'x-jyyr-request-id': row.request_id,
        'x-jyyr-attempt': String(row.attempt),
        'x-jyyr-timestamp': timestamp,
        'x-jyyr-signature': `sha256=${sign(secret, timestamp, body)}`,
      },
      body,
      redirect: 'error',
      signal: AbortSignal.timeout(8000),
      cache: 'no-store',
    });

    const latencyMs = Date.now() - started;
    const responseText = await response.text().catch(() => '');
    const ok = response.status >= 200 && response.status < 300;

    if (ok) {
      await admin
        .from('webhook_deliveries')
        .update({
          status: 'delivered',
          response_code: response.status,
          latency_ms: latencyMs,
          response_excerpt: safeExcerpt(responseText),
          next_retry_at: null,
          locked_at: null,
          locked_by: null,
        })
        .eq('id', row.id);

      await admin
        .from('webhooks')
        .update({ last_delivery_at: new Date().toISOString() })
        .eq('id', row.webhook_id);

      return { ok: true, terminal: true };
    }

    await markDeliveryFailure(admin, row, webhook.retry_policy, response.status, latencyMs, responseText);
    return { ok: false, terminal: false };
  } catch (error) {
    const latencyMs = Date.now() - started;
    const message = error instanceof Error ? error.message : 'Webhook delivery failed';
    await markDeliveryFailure(admin, row, webhook.retry_policy, null, latencyMs, message);
    return { ok: false, terminal: false };
  }
}

async function markDeliveryFailure(
  admin: ReturnType<typeof createAdminClient>,
  row: DeliveryRow,
  policyValue: unknown,
  responseCode: number | null,
  latencyMs: number,
  excerpt: string,
) {
  const policy = retryPolicy(policyValue);
  const hasRetry = row.attempt < policy.max_attempts;
  const delayIndex = Math.min(
    Math.max(row.attempt - 1, 0),
    Math.max(policy.backoff_seconds.length - 1, 0),
  );
  const delaySeconds = hasRetry
    ? Math.max(0, Number(policy.backoff_seconds[delayIndex] ?? 60))
    : 0;

  await admin
    .from('webhook_deliveries')
    .update({
      status: 'failed',
      response_code: responseCode,
      latency_ms: latencyMs,
      response_excerpt: safeExcerpt(excerpt),
      attempt: row.attempt + (hasRetry ? 1 : 0),
      next_retry_at: hasRetry ? new Date(Date.now() + delaySeconds * 1000).toISOString() : null,
      locked_at: null,
      locked_by: null,
    })
    .eq('id', row.id);
}

async function fetchRowsByIds(ids: string[]): Promise<DeliveryRow[]> {
  if (!ids.length) return [];
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('webhook_deliveries')
    .select('id,webhook_id,event,request_id,attempt,status,response_code,latency_ms,response_excerpt,created_at,next_retry_at,payload,locked_at,locked_by')
    .in('id', ids);
  if (error) throw new Error(error.message);
  return (data ?? []) as DeliveryRow[];
}

export async function dispatchWebhookDeliveries(ids: string[]): Promise<number> {
  const rows = await fetchRowsByIds([...new Set(ids)]);
  if (!rows.length) return 0;

  const admin = createAdminClient();
  let processed = 0;
  for (const row of rows) {
    if (!['pending', 'failed'].includes(row.status)) continue;
    const { data: webhook, error } = await admin
      .from('webhooks')
      .select('endpoint_url,secret_ciphertext,retry_policy,status')
      .eq('id', row.webhook_id)
      .eq('status', 'active')
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!webhook) continue;
    await deliverRow(row, webhook);
    processed += 1;
  }
  return processed;
}

export async function dispatchDueWebhookDeliveries(limit = 25): Promise<number> {
  const admin = createAdminClient();
  const workerId = `vercel-${crypto.randomUUID()}`;
  const { data, error } = await admin.rpc('claim_webhook_deliveries', {
    p_worker_id: workerId,
    p_limit: Math.min(Math.max(limit, 1), 100),
  });
  if (error) throw new Error(error.message);

  const rows = (data ?? []) as DeliveryRow[];
  let processed = 0;
  for (const row of rows) {
    const { data: webhook, error: webhookError } = await admin
      .from('webhooks')
      .select('endpoint_url,secret_ciphertext,retry_policy,status')
      .eq('id', row.webhook_id)
      .maybeSingle();
    if (webhookError) throw new Error(webhookError.message);
    if (!webhook || webhook.status !== 'active') {
      await admin
        .from('webhook_deliveries')
        .update({
          status: 'failed',
          response_excerpt: 'Webhook is not active',
          next_retry_at: null,
          locked_at: null,
          locked_by: null,
        })
        .eq('id', row.id);
      processed += 1;
      continue;
    }
    await deliverRow(row, webhook);
    processed += 1;
  }
  return processed;
}
