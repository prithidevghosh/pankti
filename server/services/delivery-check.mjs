import { z } from 'zod';

const name = z.string().trim().min(1).max(160);
const quantity = z.number().min(0).max(1e8).nullable();
const unit = z.string().trim().min(1).max(60).nullable();
export const invoiceSchema = z.object({
  vendor: name.nullable(), number: name.nullable(),
  lines: z.array(z.object({ name, quantity, unit, ratePaise: z.number().int().nonnegative().max(1e9).nullable() })).min(1).max(200),
});
const measure = z.object({ quantity: z.number().min(0).max(1e8), unit }).nullable();
const claimsSchema = z.array(z.object({ line: z.number().int().nonnegative().nullable(), name, ordered: measure, received: measure })).max(200);
const measures = new Map(Object.entries({
  kg: ['weight', 1000], g: ['weight', 1], l: ['volume', 1000], ml: ['volume', 1],
}));
function convert(value, target) {
  if (!value?.unit || !target) return null;
  const source = value.unit.toLowerCase(), dest = target.toLowerCase();
  if (source === dest) return value.quantity;
  const a = measures.get(source), b = measures.get(dest);
  return a && b && a[0] === b[0] ? value.quantity * a[1] / b[1] : null;
}
export function compareDelivery(invoice, input) {
  const claims = claimsSchema.parse(input);
  const used = new Set();
  const rows = invoice.lines.map((line, i) => {
    const matches = claims.filter(claim => claim.line === i);
    matches.forEach(claim => used.add(claim));
    const claim = matches.length === 1 ? matches[0] : null;
    const ordered = convert(claim?.ordered, line.unit), received = convert(claim?.received, line.unit);
    const delta = (a,b) => a == null || b == null ? null : Number((a-b).toFixed(6));
    const shortage = delta(line.quantity, received);
    const orderDifference = delta(line.quantity, ordered);
    const status = shortage || orderDifference ? 'difference'
      : shortage === 0 && orderDifference === 0 ? 'match' : 'review';
    return { ...line, ordered: claim?.ordered ?? null, received: claim?.received ?? null,
      shortage, orderDifference, status,
      differencePaise: shortage != null && line.ratePaise != null ? Math.round(shortage * line.ratePaise) : null };
  });
  return { rows, unmatched: claims.filter(c => !used.has(c)) };
}
