// Use the same hosted flow and success message as Phone.Email's web button.
// Opening synchronously from submit preserves the browser's user activation.
export function openPhoneVerification(clientId, phone, signal) {
  const provider = 'https://auth.phone.email';
  const url = new URL('/log-in', provider);
  url.search = new URLSearchParams({ client_id: clientId, auth_type: '8',
    origin: window.location.origin, user_phone_no: phone });
  const popup = window.open(url, 'pankti-phone-verification', 'popup,width=500,height=560');
  if (!popup) throw new Error('Allow the verification window in your browser, then try again.');
  return new Promise((resolve, reject) => {
    function finish(error, receipt) {
      window.removeEventListener('message', received);
      signal.removeEventListener('abort', cancelled);
      clearInterval(poll);
      clearTimeout(timeout);
      popup.close();
      if (error) reject(error);
      else resolve(receipt);
    }
    function received(event) {
      if (event.origin !== provider || event.source !== popup || String(event.data?.flag_phone) !== '1') return;
      if (typeof event.data.user_json_url === 'string') finish(null, event.data.user_json_url);
    }
    function cancelled() { finish(new Error('Verification closed. You can try again.')); }
    const poll = setInterval(() => { if (popup.closed) cancelled(); }, 700);
    const timeout = setTimeout(() => finish(new Error('Verification timed out. Please try again.')), 600000);
    window.addEventListener('message', received);
    signal.addEventListener('abort', cancelled, { once: true });
  });
}
