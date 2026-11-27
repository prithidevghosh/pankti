// India uses UTC+05:30 year-round. Expiry is the shop's midnight, on every device.
export function indiaDay(now = Date.now()) {
  return new Date(now + 19800000).toISOString().slice(0, 10);
}
