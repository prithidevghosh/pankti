import { z } from 'zod';
export const shortText = z.string().trim().min(1).max(96);
export const restaurantSchema = z.object({ name: shortText, city: shortText }).strict();
export const entrySchema = z
  .object({
    name: shortText,
    variant: z.string().trim().max(64),
    category: shortText,
    price: z.number().int().min(1).max(10000000),
  })
  .strict();
export const lineSchema = z
  .object({
    item: z.uuid(),
    note: z.string().trim().max(400).optional(),
    quantity: z.number().multipleOf(0.25).min(0.25).max(99),
  })
  .strict();
export const basketSchema = z
  .array(lineSchema)
  .max(60)
  .refine(
    (lines) => new Set(lines.map((line) => line.item)).size === lines.length,
    'Each item can appear once.',
  );
export const vendorEntries = z
  .array(
    z
      .object({
        vendor: shortText,
        kind: z.enum(['order', 'purchase', 'payment', 'balance']),
        note: z.string().trim().max(300),
        amount: z.number().int().min(0).max(1000000000),
      })
      .refine((entry) => entry.amount > 0 || ['order', 'balance'].includes(entry.kind)),
  )
  .max(30);
export const vendorCorrection = z.object({
  vendor: shortText,
  note: z.string().trim().max(300),
  amount: z.number().int().nonnegative().max(1000000000),
  paid: z.number().int().nonnegative().max(1000000000),
});
