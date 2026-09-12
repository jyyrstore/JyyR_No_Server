'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

type Row = {
  id: string;
  code: string;
  name: string;
  flag: string;
};

type Service = {
  id: string;
  slug: string;
  name: string;
  icon: string;
};

type StockRow = {
  providerId: string;
  provider: string;
  stock: number;
  priceCents: number;
  currency: string;
};

export default function BuyPage() {
  const router = useRouter();

  const [countries, setCountries] = useState<Row[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [country, setCountry] = useState('');
  const [service, setService] = useState('');
  const [stock, setStock] = useState<StockRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [buying, setBuying] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const [cr, sr] = await Promise.all([
          fetch('/api/countries', { cache: 'no-store' }),
          fetch('/api/services', { cache: 'no-store' }),
        ]);

        const [c, s] = await Promise.all([
          cr.json(),
          sr.json(),
        ]);

        const nextCountries: Row[] = c.data ?? [];
        const nextServices: Service[] = s.data ?? [];

        setCountries(nextCountries);
        setServices(nextServices);
        setCountry(nextCountries[0]?.id ?? '');
        setService(nextServices[0]?.id ?? '');
      } catch {
        setMessage('Unable to load marketplace catalog.');
      }
    })();
  }, []);

  useEffect(() => {
    if (!country || !service) {
      return;
    }

    let cancelled = false;

    void (async () => {
      setLoading(true);
      setMessage('');

      try {
        const r = await fetch(
          `/api/stock?country_id=${encodeURIComponent(country)}&service_id=${encodeURIComponent(service)}`,
          { cache: 'no-store' }
        );

        const b = await r.json();

        if (cancelled) return;

        setStock(b.data ?? []);

        if (!r.ok) {
          setMessage(b.error?.message ?? 'Stock unavailable');
        }
      } catch {
        if (cancelled) return;

        setStock([]);
        setMessage('Stock unavailable');
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [country, service]);

  async function buy(row: StockRow) {
    if (buying) return;
    setBuying(true);
    setMessage('Reserving number…');

    const key = crypto.randomUUID();

    try {
      const r = await fetch('/api/v1/activations', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'Idempotency-Key': key,
        },
        body: JSON.stringify({ country_id: country, service_id: service, provider_id: row.providerId }),
      });

      const b = await r.json();

      if (r.ok) {
        router.push(`/dashboard/orders/${b.data.order_id}`);
        return;
      }

      setMessage(b.error?.message ?? 'Purchase failed');
    } catch {
      setMessage('Purchase failed');
    } finally {
      setBuying(false);
    }
  }

  return (
    <main>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm muted">Marketplace</p>
          <h1 className="text-3xl font-black">Buy a temporary number</h1>
        </div>

        <Link className="btn btn-ghost" href="/dashboard/wallet">
          Wallet
        </Link>
      </div>

      <div className="glass mt-6 grid gap-4 rounded-2xl p-5 sm:grid-cols-2">
        <select
          className="field"
          value={country}
          onChange={(e) => setCountry(e.target.value)}
        >
          {countries.map((c) => (
            <option value={c.id} key={c.id}>
              {c.flag} {c.name}
            </option>
          ))}
        </select>

        <select
          className="field"
          value={service}
          onChange={(e) => setService(e.target.value)}
        >
          {services.map((s) => (
            <option value={s.id} key={s.id}>
              {s.icon} {s.name}
            </option>
          ))}
        </select>
      </div>

      {message && (
        <div className="mt-4 rounded-xl border border-purple-400/20 bg-purple-400/10 p-4 text-sm">
          {message}
        </div>
      )}

      <div className="mt-6 grid gap-3">
        {loading ? (
          <div className="glass rounded-2xl p-7 text-center muted">
            Loading stock…
          </div>
        ) : stock.length === 0 ? (
          <div className="glass rounded-2xl p-7 text-center muted">
            No stock available for this selection.
          </div>
        ) : (
          stock.map((r) => (
            <div
              className="glass flex flex-wrap items-center justify-between gap-4 rounded-2xl p-5"
              key={`${r.providerId}-${r.priceCents}`}
            >
              <div>
                <div className="font-bold">{r.stock.toLocaleString()} numbers available</div>
                <div className="mt-1 text-sm muted">{r.provider} · Temporary OTP activation</div>
              </div>

              <div className="flex items-center gap-3">
                <div className="text-right font-black">
                  {r.currency} {(r.priceCents / 100).toLocaleString('id-ID')}
                </div>

                <button className="btn btn-primary" onClick={() => buy(r)} disabled={buying}>BUY NUMBER</button>
              </div>
            </div>
          ))
        )}
      </div>
    </main>
  );
}
