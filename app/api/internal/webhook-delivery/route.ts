import { NextResponse } from 'next/server';
import { dispatchDueWebhookDeliveries } from '@/services/webhook-delivery';

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const processed = await dispatchDueWebhookDeliveries(25);
    return NextResponse.json({ ok: true, processed });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Webhook worker failed' },
      { status: 500 },
    );
  }
}
