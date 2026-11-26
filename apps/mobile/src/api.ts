const origin = process.env.EXPO_PUBLIC_API_URL?.replace(/\/$/, '') || 'http://10.0.2.2:4100';

export type Restaurant = { id: string; name: string; city: string; qr: string | null; payee: string | null };
export type Entry = { name: string; variant: string; category: string; price: number };
export type Item = Entry & { id: string };
export type Line = { item: string; quantity: number };
export type Bill = {
  id: string;
  number: number;
  created: string;
  total: number;
  paid: string | null;
  method: 'cash' | 'upi' | null;
  lines: (Line & Pick<Entry, 'name' | 'variant' | 'price'>)[];
};
export type Workspace = { restaurant: Restaurant | null; menu: Item[]; pendingBill: Bill | null };
export type Qr = { uri: string; payee: string; address: string; image: string };
export type Task = 'onboarding' | 'menu' | 'order';
export type Results = {
  onboarding: { name: string | null; city: string | null; question: string | null };
  menu: { entries: Entry[]; question: string | null };
  order: { lines: Line[]; question: string | null; readyToBill: boolean };
};
export const formatMoney = (paise: number) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(paise / 100);

function appendFile(form: FormData, name: string, file: { uri: string; type: string; name: string }) {
  // React Native accepts local file descriptors for multipart upload.
  form.append(name, file as unknown as Blob);
}

async function request<T>(path: string, method = 'GET', body?: object | FormData, token?: string): Promise<T> {
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = 'Bearer ' + token;
  if (body && !(body instanceof FormData)) headers['Content-Type'] = 'application/json';
  const response = await fetch(origin + '/api' + path, {
    method,
    headers,
    body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
  });
  if (!response.headers.get('content-type')?.includes('application/json'))
    throw new Error('Could not reach the restaurant server.');
  const value = await response.json();
  if (!response.ok) throw Object.assign(new Error(value.error || 'Could not complete the request.'), {
    status: response.status,
  });
  return value;
}

export type AuthMode = 'phone-only' | 'otp';
export type SignupDraft = { name: string | null; businessName: string | null; phone: string | null };

export const phoneAuth = {
  mode: async () => (await request<{ mode: AuthMode }>('/auth/session')).mode,
  login: (phone: string) => request<{ token: string }>('/auth/login', 'POST', { phone, client: 'android' }),
  signup: (phone: string, name: string, businessName: string) =>
    request<{ token: string }>('/auth/signup', 'POST', { phone, name, businessName, client: 'android' }),
  signupVoice(uri: string) {
    const form = new FormData();
    appendFile(form, 'audio', { uri, name: 'signup.m4a', type: 'audio/mp4' });
    return request<SignupDraft>('/signup/voice', 'POST', form);
  },
  send: (phone: string) => request<{ challenge: string }>('/auth/send', 'POST', { phone }),
  verify: (challenge: string, code: string) =>
    request<{ token: string }>('/auth/verify', 'POST', { challenge, code, client: 'android' }),
  signOut: (token: string) => request('/auth/logout', 'POST', {}, token),
};

export function api(token: string, onSessionExpired: () => void) {
  async function call<T>(path: string, method = 'GET', body?: object | FormData) {
    try {
      return await request<T>(path, method, body, token);
    } catch (error) {
      if ((error as { status?: number }).status === 401) onSessionExpired();
      throw error;
    }
  }
  return {
    workspace: () => call<Workspace>('/workspace'),
    setup: (name: string, city: string) =>
      call<{ restaurant: Restaurant }>('/workspace', 'POST', { name, city }),
    menu: (entries: Entry[]) => call<{ menu: Item[] }>('/menu', 'POST', entries),
    voice: <T extends Task>(task: T, uri: string, context: object) => {
      const form = new FormData();
      appendFile(form, 'audio', { uri, name: 'recording.m4a', type: 'audio/mp4' });
      form.append('context', JSON.stringify(context));
      return call<{ transcript: string; result: Results[T] }>('/voice/' + task, 'POST', form);
    },
    qr: (uri: string, type: string) => {
      const form = new FormData();
      appendFile(form, 'photo', { uri, name: 'qr-card.jpg', type });
      return call<Qr>('/qr/preview', 'POST', form);
    },
    saveQr: (uri: string) => call<{ restaurant: Restaurant }>('/qr', 'PUT', { uri }),
    bill: (request: string, basket: Line[]) => call<{ bill: Bill }>('/bills', 'POST', { request, basket }),
    payment: (id: string, method: 'cash' | 'upi') =>
      call<{ bill: Bill }>('/bills/' + id + '/payment', 'POST', { method }),
  };
}
