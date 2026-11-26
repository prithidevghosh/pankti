# Pankti MVP

Build an Android-first mobile counter app and a separate owner website. Phone OTP opens the same restaurant on both. All records flow through one authenticated API into a durable database.

## Scope

- Voice onboarding records the restaurant name and location.
- Voice menu intake extracts names, variants, categories and prices into a spoken-confirmation draft.
- Voice orders support additions, removals and corrections before billing. The server prices orders from the approved menu.
- Billing creates a numbered receipt with the restaurant's existing UPI QR when configured. The cashier confirms cash or checks the merchant's payment notification before recording a UPI payment.
- The owner website shows paid sales, order counts, average bill, hourly sales, top items and recent bills from saved data.
- The existing QR card is photographed or uploaded as an image. This is the one image intake tool in the current mobile flow. Menu photography, vendor operations and campaigns are follow-on scope.

## Sequence and checks

1. Document credentials and scope.
2. Build database, phone OTP and session verification, provider adapters and write operations.
3. Build the voice-first Android counter and responsive owner website.
4. Verify billing and analytics through the HTTP API, check layout, and compile both clients.
5. Exercise real OTP and speech on a device when the project credentials are available.

Start with short recorded voice notes using Sarvam's documented synchronous endpoint. Keep transcription isolated so streaming can be introduced after measuring the working flow. Use one deployment instance with a durable volume for the MVP database. Store transactional amounts in integer paise and use India time for analytics. Keep restaurant access scoped to the verified phone account. Persist voice-derived business records and discard audio after transcription.

## Build status

- Mobile voice capture, menu and order drafts, billing and UPI QR setup are implemented.
- The owner dashboard reads persisted sales and bills. Browser verification covered the dashboard and receipt on desktop and narrow screens using a temporary test identity with the actual API and database.
- API integration tests, mobile type checks and Android bundle export passed. Live OTP, speech and device checkout need the owner's provider credentials and an installed native build.

## GitHub development history

Keep the Pankti repository public so the development history is easy to follow. Commit one coherent change at a time with a descriptive message. Run the checks relevant to that change and push it once they pass. Use new commits for follow-up fixes so the history shows how the project evolved. Keep credentials, local databases, and generated builds out of Git.
