import express from 'express';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { createApp } from './app.mjs';
import { twilioVerify } from './phone-auth.mjs';

const localPhoneOnly = process.env.APP_AUTH_MODE === 'phone-only';
const { app } = createApp({
  database: localPhoneOnly ? '.data/pankti-local-signup.sqlite' : process.env.DATABASE_PATH || '.data/pankti.sqlite',
  localPhoneOnly,
  otp: twilioVerify(),
  requireLegacyImport: Boolean(process.env.FIREBASE_PROJECT_ID || process.env.VITE_FIREBASE_PROJECT_ID),
});
const web = resolve('apps/web/dist');
if (existsSync(web)) app.use(express.static(web));
app.listen(Number(process.env.PORT || 4100), localPhoneOnly ? '127.0.0.1' : '0.0.0.0', () => {
  console.log(`Pankti API listening on port ${process.env.PORT || 4100}`);
});
