import { z } from 'zod';

export const apiKeyPermissionSchema = z.enum([
  'numbers:read',
  'messages:read',
  'webhooks:read',
  'webhooks:write',
]);

export const apiKeySchema = z.object({
  name: z.string().trim().min(2).max(80),
  permissions: z.array(apiKeyPermissionSchema).min(1).max(4).default(['numbers:read']),
});
