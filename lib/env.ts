import { z } from 'zod';

const blankToUndefined = (value: unknown) => {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
};

const publicEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(10),
});

const serverEnvSchema = publicEnvSchema.extend({
  SUPABASE_SERVICE_ROLE_KEY: z.preprocess(blankToUndefined, z.string().min(10).optional()),
  DATABASE_URL: z.preprocess(blankToUndefined, z.string().url().optional()),
  DEMO_MODE: z.preprocess(blankToUndefined, z.coerce.boolean()).default(false),
  API_RATE_LIMIT_PER_MINUTE: z.preprocess(blankToUndefined, z.coerce.number().int().positive()).default(100),
  WEBHOOK_ENCRYPTION_KEY: z.preprocess(blankToUndefined, z.string().min(16).optional()),
  APP_BASE_URL: z.preprocess(blankToUndefined, z.string().url()).default('http://localhost:3000'),
  CRON_SECRET: z.preprocess(blankToUndefined, z.string().min(16).optional()),
  TWILIO_ACCOUNT_SID: z.preprocess(blankToUndefined, z.string().optional()),
  TWILIO_AUTH_TOKEN: z.preprocess(blankToUndefined, z.string().optional()),
  TWILIO_NUMBER_TYPE: z.preprocess(blankToUndefined, z.enum(['Local','Mobile','TollFree'])).default('Local'),
  TELNYX_API_KEY: z.preprocess(blankToUndefined, z.string().optional()),
  TELNYX_PUBLIC_KEY: z.preprocess(blankToUndefined, z.string().optional()),
  TELNYX_MESSAGING_PROFILE_ID: z.preprocess(blankToUndefined, z.string().optional()),
  TELNYX_CONNECTION_ID: z.preprocess(blankToUndefined, z.string().optional()),
  VONAGE_API_KEY: z.preprocess(blankToUndefined, z.string().optional()),
  VONAGE_API_SECRET: z.preprocess(blankToUndefined, z.string().optional()),
  VONAGE_SIGNATURE_SECRET: z.preprocess(blankToUndefined, z.string().optional()),
  VONAGE_SIGNATURE_METHOD: z.preprocess(
    blankToUndefined,
    z.enum(['md5', 'md5hash', 'sha1', 'sha256', 'sha512']).default('md5hash'),
  ),
  VONAGE_NUMBER_TYPE: z.preprocess(blankToUndefined, z.enum(['landline','mobile-lvn','landline-toll-free'])).default('mobile-lvn'),
  VONAGE_NUMBER_FEATURES: z.preprocess(blankToUndefined, z.string()).default('SMS'),
  STRIPE_SECRET_KEY: z.preprocess(blankToUndefined, z.string().optional()),
  STRIPE_WEBHOOK_SECRET: z.preprocess(blankToUndefined, z.string().optional()),
});

export function publicEnv() {
  return publicEnvSchema.parse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  });
}

export function serverEnv() {
  return serverEnvSchema.parse({
    ...process.env,
  });
}
