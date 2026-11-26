import { z } from 'zod';
import { httpError } from '../errors.mjs';
import { basketSchema } from '../schemas.mjs';
const businessDate = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', dateStyle: 'short' }).format(new Date());
const daySchema = z.iso.date();
export function registerBillsRoutes(app, { store, requireRestaurant }) {
  app.post('/api/bills', async (req, res) => {
    const restaurant = requireRestaurant(req);
    const { request, basket, prices } = z
      .object({
        request: z.uuid(),
        basket: basketSchema,
        prices: z.record(z.uuid(), z.number().int().positive()).optional(),
      })
      .parse(req.body);
    if (!basket.length) throw httpError(422, 'Add an item before making a bill.');
    const bill = await store.createBill(restaurant.id, request, basket, prices);
    if (!bill) throw httpError(422, 'One or more items are unavailable.');
    res.status(201).json({ bill });
  });
  app.get('/api/bills/:id', async (req, res) => {
    const bill = await store.billFor(requireRestaurant(req).id, req.params.id);
    if (!bill) throw httpError(404, 'Bill not found.');
    res.json({ bill });
  });
  app.post('/api/bills/:id/payment', async (req, res) => {
    const restaurant = requireRestaurant(req);
    const method = z.enum(['cash', 'upi']).parse(req.body?.method);
    const bill = await store.markPaid(restaurant.id, req.params.id, method);
    if (!bill) throw httpError(404, 'Bill not found.');
    if (bill.method !== method)
      throw httpError(409, 'A different payment method is already recorded for this bill.');
    res.json({ bill });
  });
  app.get('/api/analytics', async (req, res) => {
    const restaurant = requireRestaurant(req);
    const date = daySchema.parse(req.query.date ?? businessDate());
    res.json(await store.analytics(restaurant.id, date));
  });
}
