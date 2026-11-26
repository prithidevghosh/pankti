import { registerBillsRoutes } from './routes/bills.mjs';
import { registerVendorsRoutes } from './routes/vendors.mjs';
import { interpretRecording } from './services/voice.mjs';
import express from 'express';
import multer from 'multer';
import { z, ZodError } from 'zod';
import { openStore } from './store.mjs';
import { indiaPhone, registerPhoneAuth, requestToken } from './phone-auth.mjs';
import { scanMenu, transcribe, interpret, decodeQr, renderQr } from './providers.mjs';
import { httpError } from './errors.mjs';
import { restaurantSchema, shortText, entrySchema } from './schemas.mjs';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024, files: 1, fields: 2, fieldSize: 24576 },
});
const workspace = async (restaurant) =>
  restaurant
    ? {
        id: restaurant.id,
        name: restaurant.name,
        city: restaurant.city,
        qr: await renderQr(restaurant.qr),
        payee: restaurant.payee,
      }
    : null;

export async function createApp({
  verify,
  database,
  otp,
  requireLegacyImport = false,
  localPhoneOnly = false,
  speech = transcribe,
  understand = interpret,
  scan = scanMenu,
}) {
  const store = await openStore(database);
  const app = express();
  app.disable('x-powered-by');
  app.use('/api', express.json({ limit: '256kb' }), (_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));
  if (localPhoneOnly) {
    app.use('/api', (req, _res, next) => {
      const localHost = ['127.0.0.1', 'localhost', '[::1]', '10.0.2.2'].includes(req.hostname);
      if (!localHost || req.get('sec-fetch-site') === 'cross-site')
        throw httpError(403, 'This workspace is available only on this device.');
      next();
    });
    app.post('/api/signup/voice', upload.single('audio'), async (req, res) => {
      if (!req.file?.size) throw httpError(400, 'Record your signup details first.');
      if (!/^(audio\/|video\/mp4$)/.test(req.file.mimetype))
        throw httpError(400, 'This recording format is unavailable.');
      const transcript = await speech(req.file);
      const draft = await understand('signup', transcript, {});
      const name = shortText.safeParse(draft.name);
      const businessName = shortText.safeParse(draft.businessName);
      res.json({
        name: name.success ? name.data : null,
        businessName: businessName.success ? businessName.data : null,
        phone: typeof draft.phone === 'string' && indiaPhone.test(draft.phone) ? draft.phone : null,
      });
    });
  }
  registerPhoneAuth(app, store, { otp, requireLegacyImport, localPhoneOnly });
  app.use('/api', async (req, _res, next) => {
    const token = requestToken(req);
    if (!token) throw httpError(401, 'Sign in to continue.');
    req.uid = verify ? await verify(token) : await store.phoneSessionOwner(token);
    if (!req.uid) throw httpError(401, 'Your session expired. Sign in again.');
    req.restaurant = await store.restaurantFor(req.uid);
    next();
  });
  const requireRestaurant = (req) => {
    if (!req.restaurant) throw httpError(409, 'Set up your restaurant in the counter app first.');
    return req.restaurant;
  };
  app.get('/api/workspace', async (req, res) => {
    const id = req.restaurant?.id;
    res.json({
      restaurant: await workspace(req.restaurant),
      menu: id ? await store.menuFor(id) : [],
      pendingBill: id ? await store.pendingBill(id) : null,
    });
  });
  app.post('/api/workspace', async (req, res) => {
    const { name, city } = restaurantSchema.parse(req.body);
    res.json({ restaurant: await workspace(await store.createRestaurant(req.uid, name, city)) });
  });
  app.post('/api/menu', async (req, res) => {
    const restaurant = requireRestaurant(req);
    const entries = z.array(entrySchema).min(1).max(500).parse(req.body);
    res.json({ menu: await store.saveMenu(restaurant.id, entries) });
  });
  app.post('/api/menu/scan', upload.single('photo'), async (req, res) => {
    requireRestaurant(req);
    if (!req.file?.size) throw httpError(400, 'Choose a menu photo.');
    res.json({ entries: await scan(req.file.buffer) });
  });
  app.put('/api/menu/:id', async (req, res) => {
    const restaurant = requireRestaurant(req);
    if (!(await store.editMenu(restaurant.id, req.params.id, entrySchema.parse(req.body))))
      throw httpError(404, 'Menu item not found.');
    res.json({ menu: await store.menuFor(restaurant.id) });
  });
  registerVendorsRoutes(app, { store, requireRestaurant });
  app.post('/api/voice/:task', upload.single('audio'), async (req, res) => {
    const task = z.enum(['onboarding', 'menu', 'order', 'vendor', 'vendorEdit']).parse(req.params.task);
    if (!req.file?.size) throw httpError(400, 'Record a voice note first.');
    if (!/^(audio\/|video\/mp4$)/.test(req.file.mimetype))
      throw httpError(400, 'This recording format is unavailable.');
    let supplied;
    try {
      supplied = JSON.parse(req.body.context || '{}');
    } catch {
      throw httpError(400, 'Invalid voice context.');
    }
    const restaurant = task === 'onboarding' ? null : requireRestaurant(req);
    res.json(
      await interpretRecording(
        { store, speech, understand },
        task,
        req.file,
        z.record(z.string(), z.unknown()).parse(supplied),
        restaurant,
      ),
    );
  });
  app.post('/api/qr/preview', upload.single('photo'), async (req, res) => {
    requireRestaurant(req);
    if (!req.file?.size) throw httpError(400, 'Choose a photo of the QR card.');
    const { uri, payee, address } = await decodeQr(req.file.buffer);
    res.json({ uri, payee, address, image: await renderQr(uri) });
  });
  app.put('/api/qr', async (req, res) => {
    const restaurant = requireRestaurant(req);
    const photoUri = z.string().max(2048).parse(req.body?.uri);
    const png = await renderQr(photoUri);
    const { uri, payee } = await decodeQr(Buffer.from(png.split(',')[1], 'base64'));
    await store.saveQr(restaurant.id, uri, payee);
    res.json({ restaurant: await workspace(await store.restaurantFor(req.uid)) });
  });
  registerBillsRoutes(app, { store, requireRestaurant });
  app.use('/api', (_req, res) => res.status(404).json({ error: 'This route is unavailable.' }));
  app.use((error, _req, res, _next) => {
    if (error instanceof ZodError)
      return res.status(400).json({ error: 'Some details are incomplete or invalid.' });
    if (error instanceof multer.MulterError)
      return res.status(400).json({ error: 'Upload one file under 8 MB.' });
    if (error.name === 'TimeoutError')
      return res.status(504).json({ error: 'That took too long. Please try again.' });
    const status =
      Number.isInteger(error.status) && error.status >= 400 && error.status < 600 ? error.status : 500;
    if (status === 500) console.error(error.name, error.message);
    res.status(status).json({ error: status === 500 ? 'Something went wrong. Try again.' : error.message });
  });
  return { app, close: store.close };
}
