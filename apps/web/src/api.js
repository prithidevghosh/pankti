const money = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 2,
});
export const asRupees = (paise) => money.format(paise / 100);

export async function request(path, { signal, body, method } = {}) {
  const multipart = body instanceof FormData;
  const response = await fetch('/api' + path, {
    method: method || (body ? 'POST' : 'GET'),
    headers: body && !multipart ? { 'Content-Type': 'application/json' } : undefined,
    body: multipart ? body : body ? JSON.stringify(body) : undefined,
    signal,
  });
  if (!response.headers.get('content-type')?.includes('application/json'))
    throw new Error('The server is unavailable. Try again.');
  const data = await response.json();
  if (!response.ok)
    throw Object.assign(new Error(data.error || 'Could not complete the request.'), {
      status: response.status,
    });
  return data;
}
