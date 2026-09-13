'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase-browser';

export function OrderLive({
  orderId,
  initialOtp,
  initialStatus,
}: {
  orderId: string;
  initialOtp: string | null;
  initialStatus: string;
}) {
  const [otp, setOtp] = useState(initialOtp);
  const [status, setStatus] = useState(initialStatus);

  useEffect(() => {
    const supabase = createClient();

    const channel = supabase
      .channel(`order:${orderId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'orders',
          filter: `id=eq.${orderId}`,
        },
        (payload) => {
          const row = payload.new as { otp_code?: string | null; status?: string };

          setOtp(row.otp_code ?? null);

          if (row.status) {
            setStatus(row.status);
          }
        }
      )
      .subscribe();

    const timer = setInterval(async () => {
      try {
        const r = await fetch(`/api/v1/activations/${orderId}`, {
          cache: 'no-store',
        });

        if (!r.ok) return;

        const b = await r.json();

        setOtp(b.data?.otp_code ?? null);

        if (b.data?.status) {
          setStatus(b.data.status);
        }
      } catch {
        // Preserve realtime state on temporary polling failure.
      }
    }, 10000);

    return () => {
      clearInterval(timer);
      supabase.removeChannel(channel);
    };
  }, [orderId]);

  return (
    <>
      <div className="text-xl font-bold">{status}</div>

      <div className="mt-2 text-4xl font-black tracking-[.2em]">
        {otp ?? 'Waiting…'}
      </div>

      {otp && (
        <button
          className="btn btn-primary mt-4"
          onClick={() => navigator.clipboard.writeText(otp)}
        >
          Copy OTP
        </button>
      )}
    </>
  );
}
