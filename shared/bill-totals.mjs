// Prices and amounts are paise. A basis point is one hundredth of one percent.
export function billTotals(lines, gstBps = 0) {
  const subtotal = lines.reduce((sum, line) => sum + Math.round(line.price * line.quantity), 0);
  const gstAmount = Math.round(subtotal * gstBps / 10000);
  return { subtotal, gstBps, gstAmount, total: subtotal + gstAmount };
}
