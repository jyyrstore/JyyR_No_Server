'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

export function OrderActions({
  orderId,
  status,
}: {
  orderId: string;
  status: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  async function cancel() {
    setBusy(true);

    try {
      const r = await fetch(`/api/orders/${orderId}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({}),
      });

      const b = await r.json();

      setMsg(
        b.success
          ? 'Refunded successfully'
          : b.error?.message ?? 'Unable to cancel'
      );

      if (r.ok) {
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-6 flex flex-wrap gap-3">
      {['pending', 'waiting', 'sms_received'].includes(status) && (
        <button
          className="btn btn-danger"
          disabled={busy}
          onClick={cancel}
        >
          {busy ? 'Releasing…' : 'Cancel number'}
        </button>
      )}

      {msg && (
        <span className="self-center text-sm muted">
          {msg}
        </span>
      )}

      <Link className="btn btn-ghost" href="/dashboard/orders">
        Back to history
      </Link>
    </div>
  );
}
