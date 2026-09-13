export type OtpProviderStock = {
  providerCostCents: number;
  stock: number;
  currency: string;
  metadata?: Record<string, unknown>;
};

export type OtpProviderActivation = {
  providerOrderId: string;
  phoneNumber: string;
  expiresAt: string;
  providerCostCents: number;
  currency: string;
  metadata?: Record<string, unknown>;
};

export type OtpProviderStatus = 'PENDING' | 'RECEIVED' | 'FINISHED' | 'CANCELED' | 'TIMEOUT' | 'BANNED' | 'EXPIRED' | 'FAILED';

export type OtpProviderSms = {
  providerMessageId?: string;
  sender?: string;
  body: string;
  receivedAt: string;
  otpCode?: string | null;
  raw?: unknown;
};

export type OtpProviderActivationCandidate = {
  providerOrderId: string;
  phoneNumber: string;
  country: string;
  operator?: string;
  product: string;
  priceCents?: number;
  createdAt: string;
  expiresAt?: string;
  status: OtpProviderStatus;
  metadata?: Record<string, unknown>;
};

export interface OtpActivationProvider {
  readonly slug: string;
  getStock(params: { country: string; service: string; operator?: string }): Promise<OtpProviderStock>;
  getBalance(): Promise<{ balanceCents: number; currency: string }>;
  requestActivation(params: { country: string; service: string; operator?: string }): Promise<OtpProviderActivation>;
  getActivationStatus(providerOrderId: string): Promise<OtpProviderStatus>;
  findRecentActivations(params: {
    country: string;
    service: string;
    since: string;
    until: string;
  }): Promise<OtpProviderActivationCandidate[]>;
  getSms(providerOrderId: string): Promise<OtpProviderSms[]>;
  cancelActivation(providerOrderId: string): Promise<{ success: boolean; refundable?: boolean }>;
  releaseActivation?(providerOrderId: string): Promise<{ success: boolean }>;
  healthCheck(): Promise<{ status: 'active' | 'degraded' | 'disabled'; latencyMs: number }>;
}
