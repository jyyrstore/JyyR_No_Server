export type MarketOrderStatus = 'pending'|'waiting'|'sms_received'|'completed'|'cancelled'|'expired'|'refunded'|'failed';
export type Country = { id:string; code:string; name:string; flag:string|null; enabled:boolean; sort_order:number };
export type Service = { id:string; slug:string; name:string; icon:string|null; enabled:boolean };
export type StockItem = { providerId:string; provider:string; phoneNumber:string; countryCode:string; priceCents:number; stock:boolean };
