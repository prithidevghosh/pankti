# Pankti

A voice-first counter app for independent restaurants and a web ledger for the owner. Both clients use the same phone account and SQLite-backed API.

## Run locally

1. Install Node.js 22.13 or newer and run `npm ci` at the project root.
2. Follow the [credential guide](docs/CREDENTIALS.md) for Sarvam, OpenAI, and Twilio Verify. Set up the Android SDK and a device or emulator for native development.
3. Start the API with `npm run api`. Set `PORT=4100` for the default development setup.
4. Start the dashboard with `npm run web` and open the address printed by Vite. Vite forwards API requests to the local server.
5. Build and start the Android app with `npm run android --workspace @pankti/mobile`. The app uses a native development build with SecureStore.

The Android emulator can reach the API via `http://10.0.2.2:4100`. To use that local HTTP endpoint, set `EXPO_PUBLIC_API_URL` to it before generating the Android project. If Android was already generated with different settings, regenerate it with `npm exec --workspace @pankti/mobile -- expo prebuild --platform android`. Use an HTTPS API URL for a physical device or rollout.

For local signup without OTP, set `APP_AUTH_MODE=phone-only` in the root `.env` and restart the API. The website and Android app use one local workspace in `.data/pankti-local-signup.sqlite`. For a USB-connected Android device, use the API URL and ADB reverse steps in the credential guide. To use verified SMS sign-in again, remove `APP_AUTH_MODE` and restart the API. If switching an existing Firebase installation, follow the account migration in the credential guide.

To serve the built web app, run `npm run build` and restart `npm run api`. The API serves the build from the same origin. Keep the database on a persistent volume and run the API as a single deployment instance.

## Verify

- `npm test` runs API integration tests with test doubles for identity and speech. It checks account isolation, voice routing, billing, QR extraction, payment recording and persisted analytics.
- `npm run check:mobile` checks Android client types.
- `npm run build` builds the owner website.
- Use a Twilio-verified trial number or a live SMS and a real voice note to verify the provider connections on a device. To test the static QR, scan the bill with a separate phone and confirm that the displayed merchant matches the original card.

See the [scope and build plan](docs/PLAN.md) and [design brief](docs/DESIGN.md).
