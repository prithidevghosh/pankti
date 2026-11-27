# Voice workflows

- Separate billable dishes from preparation and serving requests. Keep instructions on the relevant dish or the whole order and preserve them through receipt retrieval.
- In Orders, use a spoken bill number to record cash, UPI, or partial payment. For a ₹300 bill with ₹200 remaining, the total received is ₹100. Clarify an unspecified method. Offer the same balance correction in Bills.
- In Menu, teach, confirm, review, edit and forget restaurant-specific spoken phrases. Resolve them to menu IDs and quantities and use current prices when billing.
- Check the configured Sarvam model, automatic language detection and the prompts throughout signup, menu, orders and vendors. Distinguish provider coverage from measured quality.
- Refine the shared microphone interaction and verify the new workflows alongside existing functionality. Check desktop and mobile browser widths, accounting, account isolation and retries.

## Implementation and verification

Orders sends multilingual recordings through Saaras v4 with automatic language detection (`language_code=unknown`) and verbatim transcription. The interpreter receives the restaurant menu, approved phrases and current basket. Signup, menu dictation, phrase teaching and vendor voice controls use the same transcription function. Signup transliterates personal and business names into English letters. See [Sarvam language coverage](https://docs.sarvam.ai/api/api-guides-tutorials/speech-to-text/how-to/specify-language-codes).

Phrase teaching produces a draft. Saving it stores quantities and restaurant menu IDs. Cashiers can revise the phrase by voice or forget it under Special phrases. Current menu prices determine the bill. Order notes retain the relevant dish association on the saved receipt.

Payment intents carry the bill number and explicitly spoken amounts in rupees. The server converts these to integer paise, looks up the restaurant’s bill and computes the proposed received total. The cashier reviews the amount, payment method and remaining balance. A revision check protects concurrent edits. Dated payment adjustments feed collections analytics. Historical bills without adjustment records retain their original settlement dates and amounts.

## Run QA

- `npm test` exercises API, MongoDB, import and concurrency regressions using isolated databases.
- `npm run build` followed by `PANKTI_BROWSER_CHANNEL=chrome npm run qa:voice-browser` tests the real browser recording controls, review, save and reload flows at 390 and 1280 pixels. The browser uses a synthetic microphone and provider fixtures. Tests use a separate database.
- `npm run eval:counter` and `npm run eval:vendor-edits` grade live model responses on the existing regression suites.
- `npm run eval:voice` checks live interpretation. Pass an audio directory to include live transcription. Supply one WAV per case using the names in evals/voice-workflows.mjs.
- Seven audio cases passed with synthesized Hindi, Bengali, Tamil, Kannada, Telugu and English speech. This checks routing and amounts on those samples. Restaurant noise, natural accents and the remaining supported languages require field recordings.
