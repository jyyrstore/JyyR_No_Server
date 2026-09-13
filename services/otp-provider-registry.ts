import { FiveSimProvider } from '@/providers/5sim';
import type { OtpActivationProvider } from '@/types/otp-provider';

export type OtpProviderSlug = '5sim';

export function getOtpProvider(slug: string): OtpActivationProvider {
  if (slug === '5sim') return new FiveSimProvider();
  throw new Error(`Provider ${slug} is not an OTP activation provider`);
}
