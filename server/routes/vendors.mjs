import { z } from 'zod';
import { httpError } from '../errors.mjs';
import { vendorEntries, vendorCorrection } from '../schemas.mjs';
export function registerVendorsRoutes(app, { store, requireRestaurant }) {
  app.get('/api/vendors', async (req, res) => res.json(await store.vendors(requireRestaurant(req).id)));
  app.post('/api/vendors', async (req, res) => {
    const restaurant = requireRestaurant(req);
    const { request, entries } = z
      .object({ request: z.uuid(), entries: vendorEntries.min(1) })
      .parse(req.body);
    await store.postVendor(restaurant.id, request, entries);
    res.json(await store.vendors(restaurant.id));
  });
  for (const [path, commit] of [
    ['/api/vendors/:id/preview', false],
    ['/api/vendors/:id', true],
  ]) {
    app[commit ? 'put' : 'post'](path, async (req, res) => {
      const restaurant = requireRestaurant(req);
      const id = z.coerce.number().int().positive().parse(req.params.id);
      const { revision, details } = z
        .object({ revision: z.string().length(64), details: vendorCorrection })
        .parse(req.body);
      const event = (await store.vendors(restaurant.id)).events.find((row) => row.id === id);
      if (!event) throw httpError(404, 'Vendor entry not found.');
      if (event.linkedPurchase) throw httpError(409, 'Edit the linked purchase to correct this payment.');
      if (
        details.paid > details.amount ||
        (['purchase', 'payment'].includes(event.kind) && details.amount === 0)
      )
        throw httpError(400, 'Check the entry amount and the amount paid.');
      res.json(await store.correctVendor(restaurant.id, { id, revision, details }, commit));
    });
  }
}
