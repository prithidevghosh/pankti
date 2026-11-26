import express from 'express';
import { createApp } from '../server/app.mjs';
import { twilioVerify } from '../server/phone-auth.mjs';

const app = express();
app.disable('x-powered-by');
let api;

app.use(async (req, res, next) => {
  if (req.path !== '/api' && !req.path.startsWith('/api/')) return next();
  res.set('Cache-Control', 'no-store');

  if (!process.env.MONGODB_URI) {
    return res.status(503).json({ error: 'The database is not configured.' });
  }

  api ??= createApp({ otp: twilioVerify() }).then(({ app: application }) => {
    // Vercel supplies the client IP at its ingress for the OTP rate limit.
    application.set('trust proxy', 1);
    return application;
  }).catch((error) => {
    api = undefined;
    console.error('Pankti API initialization failed', error.name);
    throw error;
  });

  let application;
  try {
    application = await api;
  } catch {
    return res.status(503).json({ error: 'The database is temporarily unavailable.' });
  }
  application(req, res, next);
});

export default app;
