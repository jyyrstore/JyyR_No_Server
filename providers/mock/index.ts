import type { NumberProvider, ProviderMessage, ProviderNumber } from '@/types/provider';

const POOLS: Record<string,string[]> = {
  ID: ['+6281200000001','+6281200000002','+6281200000003'],
  US: ['+12025550101','+12025550102','+12025550103'],
  GB: ['+447700900101','+447700900102','+447700900103'],
  CA: ['+14165550101','+14165550102'],
  AU: ['+61491570101','+61491570102'],
  FR: ['+33600000001','+33600000002'],
};

export class MockProvider implements NumberProvider {
  private reserved = new Set<string>();
  async listNumbers(countryCode: string): Promise<ProviderNumber[]> {
    const code=countryCode.toUpperCase();
    return (POOLS[code]??[]).filter(n=>!this.reserved.has(n)).map((phoneNumber)=>({
      providerId:'mock',phoneNumber,countryCode:code,capabilities:['sms'],monthlyPrice:10,numberType:'temporary',
      metadata:{mock:true},
    }));
  }
  async provisionNumber(phoneNumber: string): Promise<{externalId:string}> {
    if(this.reserved.has(phoneNumber)) throw new Error('MOCK_NO_STOCK');
    this.reserved.add(phoneNumber);
    return {externalId:`mock:${phoneNumber}`};
  }
  async releaseNumber(externalId: string): Promise<void> {
    this.reserved.delete(externalId.replace(/^mock:/,''));
  }
  async healthCheck(){ return {status:'active' as const,latencyMs:1}; }
  parseInboundWebhook(payload: unknown): ProviderMessage | null {
    if(!payload||typeof payload!=='object')return null;
    const p=payload as Record<string,unknown>;
    if(!p.to||!p.body)return null;
    return {providerMessageId:String(p.id??crypto.randomUUID()),from:String(p.from??'mock'),to:String(p.to),body:String(p.body),receivedAt:new Date().toISOString(),raw:payload};
  }
}
