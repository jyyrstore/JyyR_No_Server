import { AppShell } from '@/components/app-shell';
import { getCurrentUser } from '@/services/auth';
import { createServerSupabaseClient } from '@/lib/supabase-server';

function getSince24HoursAgo(): string {
  return new Date(Date.now() - 86400000).toISOString();
}

export default async function Dashboard() {
  const user = await getCurrentUser();

  if (!user) {
    return (
      <AppShell>
        <div className="glass rounded-2xl p-8">Login required.</div>
      </AppShell>
    );
  }

  const s = await createServerSupabaseClient();
  const since = getSince24HoursAgo();

  const [p, n, m, a, w] = await Promise.all([
    s
      .from('profiles')
      .select('balance_cents')
      .eq('id', user.id)
      .maybeSingle(),

    s
      .from('phone_numbers')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .eq('status', 'active'),

    s
      .from('inbound_messages')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .gte('received_at', since),

    s
      .from('api_requests')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .gte('created_at', since),

    s
      .from('webhook_deliveries')
      .select('id,status,created_at')
      .eq('webhooks.user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(8),
  ]);

  const cards = [
    ['Balance', `$${(Number(p.data?.balance_cents ?? 0) / 100).toFixed(2)}`],
    ['Active Numbers', String(n.count ?? 0)],
    ['Messages Today', String(m.count ?? 0)],
    ['API Requests', String(a.count ?? 0)],
  ];

  return (
    <AppShell>
      <div>
        <p className="text-sm muted">Jyy&apos;R Number Server</p>
        <h1 className="mt-1 text-3xl font-black">Control center</h1>
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map(([x, y]) => (
          <div className="glass rounded-2xl p-5" key={x}>
            <div className="text-sm muted">{x}</div>
            <div className="mt-2 text-3xl font-black">{y}</div>
          </div>
        ))}
      </div>

      <div className="mt-6 glass rounded-2xl p-6">
        <div className="font-bold">Webhook Health</div>
        <p className="mt-2 text-sm muted">
          {w.data?.some((x: { status?: string }) => x.status === 'failed')
            ? 'Investigate failed deliveries'
            : 'No recent webhook failures.'}
        </p>
      </div>
    </AppShell>
  );
}
