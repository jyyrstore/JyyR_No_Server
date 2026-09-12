import { MockProvider } from '@/providers/mock';
import type { NumberProvider } from '@/types/provider';
import { TwilioProvider } from '@/providers/twilio';
import { TelnyxProvider } from '@/providers/telnyx';
import { VonageProvider } from '@/providers/vonage';
import { CustomProvider } from '@/providers/custom';

export type ProviderSlug = 'twilio' | 'telnyx' | 'vonage' | 'custom' | 'mock';

export function getProvider(slug: string): NumberProvider {
  switch (slug) {
    case 'twilio': return new TwilioProvider();
    case 'telnyx': return new TelnyxProvider();
    case 'vonage': return new VonageProvider();
    case 'custom': return new CustomProvider();
    case 'mock': return new MockProvider();
    default: throw new Error(`Unsupported provider: ${slug}`);
  }
}
