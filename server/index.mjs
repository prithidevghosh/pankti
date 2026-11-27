import express from 'express';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { createApp } from './app.mjs';
import { twilioVerify } from './phone-auth.mjs';

const localPhoneOnly = process.env.APP_AUTH_MODE === 'phone-only';
const { app, close } = await createApp({
  localPhoneOnly,
  otp: twilioVerify(),
  phoneEmailClientId: localPhoneOnly ? undefined : process.env.PHONE_EMAIL_CLIENT_ID?.trim(),
  requireLegacyImport: Boolean(process.env.FIREBASE_PROJECT_ID || process.env.VITE_FIREBASE_PROJECT_ID),
});
const web = resolve('apps/web/dist');
if (existsSync(web)) app.use(express.static(web));
const server = app.listen(Number(process.env.PORT || 4100), process.env.PANKTI_BIND_ADDRESS || (localPhoneOnly ? '127.0.0.1' : '0.0.0.0'), () => {
  console.log(`Pankti API listening on port ${process.env.PORT || 4100}`);
});

function shutdown() {
  server.close(async () => {
    await close();
  });
}
process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);
