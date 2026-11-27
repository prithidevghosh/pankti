import { createHash } from 'node:crypto';
import { z } from 'zod';
import { invoiceSchema, compareDelivery } from '../services/delivery-check.mjs';
import { httpError } from '../errors.mjs';

export function registerVendorInvoices(app, { store, requireRestaurant, upload, readInvoice, speech, understand }) {
  const path = '/api/vendor-invoices';
  app.get(path, async (req,res) => res.json({ invoices: await store.listInvoices(requireRestaurant(req).id) }));
  app.post(path, upload.single('bill'), async (req,res) => {
    const shop = requireRestaurant(req).id, file = req.file;
    if (!file?.size || !['application/pdf','image/png','image/jpeg','image/webp'].includes(file.mimetype))
      throw httpError(422, 'Choose a PDF, JPG, PNG or WebP invoice (up to 8 MB).');
    const id = createHash('sha256').update(shop).update(file.buffer).digest('hex');
    const existing = await store.invoice(shop,id);
    if (existing) return res.json(existing);
    const parsed = await readInvoice(file);
    if (!parsed.lines?.length) throw httpError(422, 'No invoice items were readable. Try a clearer bill.');
    res.json(await store.addInvoice(shop,id,invoiceSchema.parse(parsed),file));
  });
  app.get(path+'/:id/source', async (req,res) => {
    const invoice = await store.invoiceSource(requireRestaurant(req).id,req.params.id);
    if (!invoice) throw httpError(404,'Invoice not found.');
    res.set('X-Content-Type-Options','nosniff').set('Content-Security-Policy',"sandbox").type(invoice.mime).send(Buffer.from(invoice.source.buffer));
  });
  app.post(path+'/:id/check', upload.single('audio'), async (req,res) => {
    const shop = requireRestaurant(req).id;
    const invoice = await store.invoice(shop,req.params.id);
    if (!invoice) throw httpError(404,'Invoice not found.');
    if (!req.file?.size || !/^(audio\/|video\/mp4$)/.test(req.file.mimetype)) throw httpError(422,'Record the delivery details first.');
    const revision = z.coerce.number().int().nonnegative().parse(req.body.revision);
    if (revision !== invoice.revision) throw httpError(409,'This check has changed. Reload before recording.');
    const transcript = await speech(req.file,invoice.lines.map(l=>l.name));
    const {claims} = await understand('deliveryClaim',transcript,{lines:invoice.lines.map(({name,unit},line)=>({line,name,unit}))});
    if (!claims?.length) throw httpError(422,'No delivery quantities were understood. Say the item, ordered amount and received amount.');
    const check = { transcript, ...compareDelivery(invoice,claims) };
    res.json(await store.saveInvoiceCheck(shop,req.params.id,revision,check));
  });
}
