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
  DEMO_MODE: z.coerce.boolean().default(false),
  API_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(60),
  APP_BASE_URL: z.string().url().default('http://localhost:3000'),
  TWILIO_ACCOUNT_SID: z.preprocess(blankToUndefined, z.string().optional()),
  TWILIO_AUTH_TOKEN: z.preprocess(blankToUndefined, z.string().optional()),
  TWILIO_NUMBER_TYPE: z.preprocess(
    blankToUndefined,
    z.enum(['Local', 'Mobile', 'TollFree']).optional(),
  ).default('Local'),
  TELNYX_API_KEY: z.preprocess(blankToUndefined, z.string().optional()),
  TELNYX_PUBLIC_KEY: z.preprocess(blankToUndefined, z.string().optional()),
  TELNYX_MESSAGING_PROFILE_ID: z.preprocess(blankToUndefined, z.string().optional()),
  TELNYX_CONNECTION_ID: z.preprocess(blankToUndefined, z.string().optional()),
  VONAGE_API_KEY: z.preprocess(blankToUndefined, z.string().optional()),
  VONAGE_API_SECRET: z.preprocess(blankToUndefined, z.string().optional()),
  VONAGE_SIGNATURE_SECRET: z.preprocess(blankToUndefined, z.string().optional()),
  VONAGE_NUMBER_TYPE: z.preprocess(
    blankToUndefined,
    z.enum(['landline', 'mobile-lvn', 'landline-toll-free']).optional(),
  ).default('mobile-lvn'),
  VONAGE_NUMBER_FEATURES: z.preprocess(
    blankToUndefined,
    z.string().default('SMS'),
  ),
});

export function publicEnv() {
  return publicEnvSchema.parse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  });
}

export function serverEnv() {
  return serverEnvSchema.parse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    DATABASE_URL: process.env.DATABASE_URL,
    DEMO_MODE: process.env.DEMO_MODE,
    API_RATE_LIMIT_PER_MINUTE: process.env.API_RATE_LIMIT_PER_MINUTE,
    APP_BASE_URL: process.env.APP_BASE_URL,
    TWILIO_ACCOUNT_SID: process.env.TWILIO_ACCOUNT_SID,
    TWILIO_AUTH_TOKEN: process.env.TWILIO_AUTH_TOKEN,
    TWILIO_NUMBER_TYPE: process.env.TWILIO_NUMBER_TYPE,
    TELNYX_API_KEY: process.env.TELNYX_API_KEY,
    TELNYX_PUBLIC_KEY: process.env.TELNYX_PUBLIC_KEY,
    TELNYX_MESSAGING_PROFILE_ID: process.env.TELNYX_MESSAGING_PROFILE_ID,
    TELNYX_CONNECTION_ID: process.env.TELNYX_CONNECTION_ID,
    VONAGE_API_KEY: process.env.VONAGE_API_KEY,
    VONAGE_API_SECRET: process.env.VONAGE_API_SECRET,
    VONAGE_SIGNATURE_SECRET: process.env.VONAGE_SIGNATURE_SECRET,
    VONAGE_NUMBER_TYPE: process.env.VONAGE_NUMBER_TYPE,
    VONAGE_NUMBER_FEATURES: process.env.VONAGE_NUMBER_FEATURES,
  });
}
