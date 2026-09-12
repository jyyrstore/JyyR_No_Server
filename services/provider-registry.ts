import type { NumberProvider } from '@/types/provider';
import { TwilioProvider } from '@/providers/twilio';
import { TelnyxProvider } from '@/providers/telnyx';
import { VonageProvider } from '@/providers/vonage';
import { CustomProvider } from '@/providers/custom';

export type ProviderSlug = 'twilio' | 'telnyx' | 'vonage' | 'custom';

export function getProvider(slug: string): NumberProvider {
  switch (slug) {
    case 'twilio': return new TwilioProvider();
    case 'telnyx': return new TelnyxProvider();
    case 'vonage': return new VonageProvider();
    case 'custom': return new CustomProvider();
    default: throw new Error(`Unsupported provider: ${slug}`);
  }
}
