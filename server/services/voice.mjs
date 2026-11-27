import { paymentDraft } from '../payment.mjs';
import { z } from 'zod';
import { entrySchema, basketSchema, vendorCorrection, vendorEntries } from '../schemas.mjs';
import { httpError } from '../errors.mjs';

export async function interpretRecording({ store, speech, understand, owner }, task, file, supplied, restaurant) {
  const context = {};
  if (['order', 'vendor', 'phrase', 'menu'].includes(task) && supplied.clarificationReply) {
    context.clarificationReply = z
      .object({ previous: z.string().max(3000), question: z.string().max(600) })
      .parse(supplied.clarificationReply);
  }
  let keyterms = [];
  if (task !== 'onboarding') {
    if (task === 'menu') {
      context.previous = z
        .array(entrySchema)
        .max(80)
        .parse(supplied.previous ?? []);
    } else if (task === 'vendorEdit') {
      const event = (await store.vendors(restaurant.id)).events.find((e) => e.id === supplied.id);
      if (!event) throw httpError(404, 'Choose a saved vendor entry first.');
      context.entry = { ...vendorCorrection.parse(supplied.draft), kind: event.kind };
    } else if (task === 'vendor') {
      const ledger = await store.vendors(restaurant.id);
      context.vendors = ledger.balances;
      context.recentEntries = ledger.events.filter((e) => !e.linkedPurchase).slice(0, 50);
      context.revision = ledger.revision;
      keyterms = context.vendors.map((row) => row.vendor);
    } else {
      context.menu = (await store.menuFor(restaurant.id)).map(({ id, name, variant }) => ({
        id,
        name,
        variant,
      }));
      context.basket = basketSchema.parse(supplied.basket ?? []);
      if (task === 'order') context.phrases = await store.phrasesFor(restaurant.id);
      if (task === 'phrase' && supplied.previous)
        context.previous = z
          .object({ name: z.string().max(96).nullable(), lines: basketSchema })
          .parse(supplied.previous);
      keyterms = [
        ...(context.phrases || []).map((p) => p.name),
        ...new Set(context.menu.map((item) => item.name)),
      ];
    }
  } else {
    context.previous = z
      .object({ name: z.string().max(96).nullable(), city: z.string().max(96).nullable() })
      .optional()
      .parse(supplied.previous);
  }
  const transcript = await speech(file, keyterms);
  await store.recordTranscript(owner, restaurant?.id || null, task, transcript);
  const result = await understand(task, transcript, context);
  if (task === 'vendor') {
    result.entries = vendorEntries.parse(result.entries);
    if (result.editId != null) {
      const entry = context.recentEntries.find((row) => row.id === result.editId);
      if (!entry) throw httpError(422, 'Select the vendor entry and use Speak correction.');
      const change = await understand('vendorEdit', transcript, {
        entry,
        clarificationReply: context.clarificationReply,
      });
      result.entries = [];
      result.question = change.question;
      if (!change.question)
        result.edit = { id: entry.id, revision: context.revision, details: vendorCorrection.parse(change) };
    }
  }
  if (
    ['order', 'phrase'].includes(task) &&
    result.lines.some((line) => !context.menu.some((item) => item.id === line.item))
  ) {
    throw httpError(422, 'One of those items could not be matched to the menu. Try the full dish name.');
  }
  if (task === 'order' && result.question && result.payment) {
    result.payment = null;
    result.lines = context.basket;
    result.readyToBill = false;
  }
  if (task === 'order' && result.payment) {
    const intent = z
      .object({
        number: z.number().int().positive(),
        method: z.enum(['cash', 'upi']).nullable(),
        due: z.number().int().nonnegative().nullable(),
        received: z.number().int().nonnegative().nullable(),
        additional: z.number().int().nonnegative().nullable(),
      })
      .parse(result.payment);
    const bill = await store.billByNumber(restaurant.id, intent.number);
    if (!bill) throw httpError(404, 'That bill number was not found in your restaurant.');
    result.payment = { bill, ...paymentDraft(bill, intent) };
    result.lines = context.basket;
    result.readyToBill = false;
  }
  return { transcript, result };
}
