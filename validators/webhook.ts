import { z } from 'zod';
export const webhookSchema = z.object({
  name: z.string().min(2).max(80),
  url: z.string().url(),
  event: z.enum(['sms.received','number.activated','number.released','number.status_changed']),
});
