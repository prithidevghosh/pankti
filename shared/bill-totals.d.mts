export function billTotals(lines: ReadonlyArray<{ price: number; quantity: number }>, gstBps?: number):
  { subtotal: number; gstBps: number; gstAmount: number; total: number };
