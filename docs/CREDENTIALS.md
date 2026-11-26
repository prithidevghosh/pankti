# Local credentials

Copy the repository root `.env.example` to `.env`. The API and the web dev server read that file. Keep secrets in this local ignored file or the deployment's environment settings.

## Sarvam

Sign in to [Sarvam](https://indus.sarvam.ai/) and generate one API key. Set `SARVAM_API_KEY` in the root `.env`. The app sends audio through our backend. This key can also support menu OCR when photo import is added.

## Twilio Verify

1. Sign up for Twilio using a +91 phone number. Under **Verify → Overview → Try out Verify**, copy the service SID from the example API request. On an upgraded account, you can also create a service in **Verify → Services** and set it to six-digit codes. Put the SID starting with `VA` in `TWILIO_VERIFY_SERVICE_SID`. [Verify trial](https://www.twilio.com/docs/usage/trials/try-out-verify) · [Verify Services](https://console.twilio.com/us1/develop/verify/services)
2. In **API keys & tokens**, create a **Standard** API key in the same account and region as the Verify service. Put the SID starting with `SK` in `TWILIO_API_KEY_SID`. Put the secret shown when you create the key in `TWILIO_API_KEY_SECRET`. Put all three in the repository root `.env`, which is read by the server. [Twilio API keys](https://www.twilio.com/docs/usage/requests-to-twilio#use-api-keys)
3. During the trial, use the phone number you signed up with or add another number to **Verified Caller IDs**. If Twilio blocks delivery to India, check **Verify → Settings → Geo permissions** for SMS to India. [Verify geographic permissions](https://www.twilio.com/docs/verify/verify-countries-and-regions-deliverability)

Restart the API after adding the Twilio credentials. Both clients use its sign-in endpoints. The Android app stores its session in SecureStore and needs a new native build. Use HTTPS for production traffic. The website expects the API on its own origin under `/api`.

## Preserve existing Firebase accounts

If this installation previously used Firebase, keep `FIREBASE_PROJECT_ID` set until you import the accounts. Pause sign-up on the old version, take a SQLite backup, and export Auth from the same Firebase project. Keep the export outside the repo because it contains phone numbers.

```sh
npx firebase-tools login
npx firebase-tools auth:export /private/path/firebase-users.json --project YOUR_FIREBASE_PROJECT_ID --format=json
npm run auth:import-firebase -- /private/path/firebase-users.json
```

Run the import against the database that serves the app. It matches each +91 mobile number to its existing Firebase ID, so restaurant ownership and records stay intact and disabled accounts stay disabled. Sign-in remains blocked if a restaurant owner is missing from the import. Verify an existing owner can see the same workspace on both clients before retiring the old provider. [Firebase Auth export](https://firebase.google.com/docs/cli/auth)

## OpenAI

Set `OPENAI_API_KEY` in the root `.env` for structured interpretation of spoken onboarding, menu and order requests. The key remains on the backend.

## Mobile API address

Set `EXPO_PUBLIC_API_URL` in `apps/mobile/.env`. Use `http://10.0.2.2:4100` for the default Android emulator or an HTTPS endpoint reachable from your device.

For a physical Android phone connected by USB, enable USB debugging, accept the debugging prompt on the phone, and set `EXPO_PUBLIC_API_URL=http://127.0.0.1:4100` for the debug app. Run `adb reverse tcp:4100 tcp:4100` for the API and `adb reverse tcp:8081 tcp:8081` for Metro. Restart the API after setting the Twilio credentials, then rebuild the native app. Both apps use the same backend to share data.
