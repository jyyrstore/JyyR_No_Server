import type { NumberProvider, ProviderNumber } from '@/types/provider';

export class CustomProvider implements NumberProvider {
  async listNumbers(_countryCode: string): Promise<ProviderNumber[]> { return []; }
  async provisionNumber(_phoneNumber: string, _userId: string): Promise<{ externalId: string }> { throw new Error('Custom provider is not configured.'); }
  async releaseNumber(_externalId: string): Promise<void> { throw new Error('Custom provider is not configured.'); }
}
