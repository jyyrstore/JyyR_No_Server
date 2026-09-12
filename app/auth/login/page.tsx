'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase-browser';

export default function Login() {
  const router = useRouter();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState<'password' | 'otp'>('password');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();

    setErr('');
    setMsg('');

    const s = createClient();

    if (mode === 'otp') {
      const { error } = await s.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: `${location.origin}/auth/callback`,
        },
      });

      if (error) {
        setErr(error.message);
      } else {
        setMsg('Magic link sent. Check your email.');
      }

      return;
    }

    const { error } = await s.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      setErr(error.message);
    } else {
      router.push('/dashboard');
    }
  }

  return (
    <main className="grid min-h-screen place-items-center px-4">
      <div className="glass w-full max-w-md rounded-3xl p-7">
        <h1 className="text-2xl font-black">Sign in</h1>

        <p className="mt-2 text-sm muted">
          Access your Jyy&apos;R marketplace account.
        </p>

        <form className="mt-6 space-y-3" onSubmit={submit}>
          <input
            className="field"
            type="email"
            required
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />

          {mode === 'password' && (
            <input
              className="field"
              type="password"
              required
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          )}

          <button className="btn btn-primary w-full">
            {mode === 'password' ? 'Sign in' : 'Send magic link'}
          </button>
        </form>

        <div className="mt-4 flex justify-between text-sm">
          <button
            className="text-purple-300"
            onClick={() =>
              setMode(mode === 'password' ? 'otp' : 'password')
            }
          >
            {mode === 'password' ? 'Use magic link' : 'Use password'}
          </button>

          <Link
            className="text-purple-300"
            href="/auth/forgot-password"
          >
            Forgot password?
          </Link>
        </div>

        {msg && (
          <div className="mt-4 rounded-xl bg-emerald-500/10 p-4 text-sm text-emerald-200">
            {msg}
          </div>
        )}

        {err && (
          <div className="mt-4 rounded-xl bg-red-500/10 p-4 text-sm text-red-200">
            {err}
          </div>
        )}

        <div className="mt-5 text-center text-sm muted">
          <Link
            className="text-purple-300"
            href="/auth/register"
          >
            Create account
          </Link>
        </div>
      </div>
    </main>
  );
}
