import { httpError } from './errors.mjs';

// The web widget returns a bearer receipt. Fetch only Phone.Email's documented
// HTTPS resource and never follow redirects or trust phone fields from the browser.
export async function phoneEmailNumber(receipt, clientId, fetchApi = fetch) {
  if (receipt.trim() !== receipt || !/^https:\/\/user\.phone\.email\/user_[a-zA-Z0-9_-]+\.json$/.test(receipt))
    throw httpError(400, 'Invalid verification result. Please try again.');
  const response = await fetchApi(receipt, { redirect: 'error', signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw httpError(401, 'Verification is no longer available. Please try again.');
  const data = await response.json();
  const prefix = String(data.user_country_code).replace(/^\+/, '');
  const national = String(data.user_phone_number);
  if (prefix !== '91' || !/^[6-9]\d{9}$/.test(national) ||
      (data.client_id != null && String(data.client_id) !== clientId))
    throw httpError(401, 'The verification result does not match this sign-in.');
  return '+91' + national;
}
