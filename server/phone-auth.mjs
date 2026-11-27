import { phoneEmailNumber } from './phone-email.mjs';
import { z } from 'zod';
import { httpError } from './errors.mjs';
import { shortText } from './schemas.mjs';
import { sessionAge } from './phone-store.mjs';

const cookie = 'pankti_session';
export const indiaPhone = /^\+91[6-9]\d{9}$/;
const cookieSettings = (req) => ({
  httpOnly: true,
  sameSite: 'strict',
  secure: req.secure || !['127.0.0.1', 'localhost', '[::1]'].includes(req.hostname),
  path: '/api',
});

export function requestToken(req) {
  const authorization = req.get('authorization');
  if (authorization) return authorization.match(/^Bearer (\S+)$/i)?.[1];
  return req
    .get('cookie')
    ?.split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(cookie + '='))
    ?.slice(cookie.length + 1);
}

export function twilioVerify(env = process.env, fetchApi = fetch) {
  const service = env.TWILIO_VERIFY_SERVICE_SID;
  const key = env.TWILIO_API_KEY_SID;
  const secret = env.TWILIO_API_KEY_SECRET;
  if (!/^VA[a-f\d]{32}$/i.test(service || '') || !/^SK[a-f\d]{32}$/i.test(key || '') || !secret) return null;
  const base = 'https://verify.twilio.com/v2/Services/' + service;
  const authorization = 'Basic ' + Buffer.from(key + ':' + secret).toString('base64');

  async function post(endpoint, values) {
    const response = await fetchApi(base + endpoint, {
      method: 'POST',
      headers: { Authorization: authorization, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(values),
      signal: AbortSignal.timeout(12_000),
    });
    const result = await response.json();
    if (!response.ok) {
      if (endpoint === '/VerificationCheck' && (response.status === 404 || result.code === 60202)) {
        throw httpError(409, 'This code expired. Start over to request a new one.');
      }
      if (response.status === 429) throw httpError(429, 'Too many verification requests. Try again later.');
      if (result.code === 21608) {
        throw httpError(422, 'Add this number to Verified Caller IDs in the Twilio trial account.');
      }
      if (result.code === 60605) {
        throw httpError(422, 'SMS to India needs to be enabled in the Twilio Verify service.');
      }
      console.warn('Twilio Verify rejected request', response.status, Number(result.code) || 'unknown');
      throw httpError(502, 'Could not complete SMS verification. Try again later.');
    }
    return result;
  }

  return {
    async send(phone) {
      const result = await post('/Verifications', { To: phone, Channel: 'sms' });
      if (result.status !== 'pending' || !/^VE[a-f\d]{32}$/i.test(result.sid || '')) {
        throw httpError(502, 'Could not send a verification code. Try again later.');
      }
      return result.sid;
    },
    async check(sid, phone, code) {
      const result = await post('/VerificationCheck', { To: phone, Code: code });
      return result.status === 'approved' && result.to === phone && result.sid === sid;
    },
  };
}

const phoneBody = z.object({ phone: z.string().regex(indiaPhone) });
const clientType = z.enum(['web', 'android']);
const checkBody = z.object({
  challenge: z.uuid(),
  code: z.string().regex(/^\d{6}$/),
  client: clientType,
});

function respondWithSession(req, res, token, client) {
  if (client === 'android') return res.json({ token });
  res.cookie(cookie, token, { ...cookieSettings(req), maxAge: sessionAge });
  res.json({ authenticated: true });
}

export function registerPhoneAuth(app, store, { otp, requireLegacyImport, localPhoneOnly, phoneEmailClientId, receiptLookup = phoneEmailNumber }) {
  app.use('/api/auth', (req, _res, next) => {
    if (
      req.method === 'POST' &&
      (!req.is('application/json') || req.get('sec-fetch-site') === 'cross-site')
    ) {
      throw httpError(403, 'Sign-in request is not permitted.');
    }
    if (req.path === '/send' || req.path === '/verify') {
      if (localPhoneOnly) throw httpError(404, 'Use phone-only sign-in in this workspace.');
      if (!otp) throw httpError(503, 'SMS sign-in is unavailable. Twilio Verify needs to be configured.');
    }
    next();
  });
  if (localPhoneOnly) {
    const loginBody = phoneBody.extend({ client: clientType });
    const signupBody = loginBody.extend({ name: shortText, businessName: shortText, signupNotes: z.array(z.uuid()).max(100).optional() });
    app.post('/api/auth/signup', async (req, res) => {
      const details = signupBody.parse(req.body);
      respondWithSession(req, res, await store.registerLocalPhone(details), details.client);
    });
    app.post('/api/auth/login', async (req, res) => {
      const { phone, client } = loginBody.parse(req.body);
      respondWithSession(req, res, await store.signInLocalPhone(phone), client);
    });
  }

  if (phoneEmailClientId) {
    const exchange = phoneBody.extend({
      receipt: z.string().max(2048),
      signup: z.object({ name: shortText, businessName: shortText, signupNotes: z.array(z.uuid()).max(100).optional() }).optional(),
    }).strict();
    app.post('/api/auth/phone-email', async (req, res) => {
      const { phone, receipt, signup } = exchange.parse(req.body);
      const verified = await receiptLookup(receipt, phoneEmailClientId);
      if (verified !== phone) throw httpError(401, `Phone.Email returned a different number. Try again, choose “Use Other Phone”, and verify the number ending in ${phone.slice(-4)}.`);
      const token = await store.redeemPhoneEmail(verified, receipt, signup, requireLegacyImport);
      respondWithSession(req, res, token, 'web');
    });
  }
  app.post('/api/auth/send', async (req, res) => {
    const { phone } = phoneBody.parse(req.body);
    const challenge = await store.reservePhoneChallenge(phone, req.ip, requireLegacyImport);
    const sid = await otp.send(phone);
    await store.savePhoneChallenge(challenge, sid);
    res.json({ challenge });
  });
  app.post('/api/auth/verify', async (req, res) => {
    const { challenge, code, client } = checkBody.parse(req.body);
    const { phone, sid } = await store.claimPhoneChallenge(challenge);
    let approved;
    try {
      approved = await otp.check(sid, phone, code);
    } finally {
      if (!approved) await store.releasePhoneChallenge(challenge);
    }
    if (!approved) throw httpError(400, 'The code did not match. Check your SMS and try again.');
    const token = await store.completePhoneChallenge(challenge, phone);
    if (!token) throw httpError(403, 'This account is disabled.');
    respondWithSession(req, res, token, client);
  });
  app.get('/api/auth/session', async (req, res) => {
    const session = await store.activeSession(requestToken(req), !localPhoneOnly);
    res.json({
      authenticated: Boolean(session),
      ...(session && { expiresAt: session.expiresAt }),
      ...(phoneEmailClientId && { phoneEmailClientId }),
      mode: localPhoneOnly ? 'phone-only' : 'otp',
    });
  });
  app.post('/api/auth/logout', async (req, res) => {
    await store.revokePhoneSession(requestToken(req));
    res.clearCookie(cookie, cookieSettings(req));
    res.json({ authenticated: false });
  });
}
