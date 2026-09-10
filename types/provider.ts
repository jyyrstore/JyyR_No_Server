export type ProviderCapability = 'sms' | 'voice' | 'mms';
export type ProviderNumber = { providerId: string; phoneNumber: string; countryCode: string; capabilities: ProviderCapability[]; monthlyPrice: number; numberType?: string; metadata?: Record<string, unknown> };
export type ProviderMessage = { providerMessageId: string; from: string; to: string; body: string; receivedAt: string; raw: unknown };

export interface NumberProvider {
  listNumbers(countryCode: string): Promise<ProviderNumber[]>;
  provisionNumber(phoneNumber: string, userId: string, countryCode?: string): Promise<{ externalId: string }>;
  releaseNumber(externalId: string, countryCode?: string): Promise<void>;
  releaseNumber(externalId: string): Promise<void>;
  sendSms?(from: string, to: string, body: string): Promise<{ providerMessageId: string }>;
  parseInboundWebhook?(payload: unknown, headers: Headers): ProviderMessage | null;
  verifyInboundWebhook?(requestUrl: string, payload: unknown, headers: Headers): Promise<boolean>;
}
