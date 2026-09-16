import { Router, Response } from 'express';
import { AuthRequest, authMiddleware } from '../middleware/auth';
import { REGIONS, STORES } from '../services/search/stores';
import { searchStores } from '../services/search/engine';

const router = Router();

// All routes require authentication
router.use(authMiddleware);

// List searchable stores and the regions they cover
router.get('/stores', (_req: AuthRequest, res: Response) => {
  res.json({
    regions: Object.entries(REGIONS).map(([code, name]) => ({ code, name })),
    stores: STORES.map((store) => ({
      id: store.id,
      name: store.name,
      homepage: store.homepage,
      regions: store.regions,
      currency: store.currency,
    })),
  });
});

// Search stores for a product. Responds with newline-delimited JSON so the client can
// show each store's results as they arrive:
//   {"type":"start","stores":[...]}
//   {"type":"store","result":{...}}   (one per store)
//   {"type":"done","durationMs":1234}
router.post('/', async (req: AuthRequest, res: Response) => {
  const query = typeof req.body.query === 'string' ? req.body.query.trim() : '';
  const storeIds: unknown = req.body.storeIds;

  if (query.length < 2 || query.length > 100) {
    res.status(400).json({ error: 'Query must be between 2 and 100 characters' });
    return;
  }

  let stores = STORES;
  if (storeIds !== undefined) {
    if (!Array.isArray(storeIds) || !storeIds.every((id) => typeof id === 'string')) {
      res.status(400).json({ error: 'storeIds must be an array of store IDs' });
      return;
    }
    stores = STORES.filter((store) => storeIds.includes(store.id));
  }

  if (stores.length === 0) {
    res.status(400).json({ error: 'Select at least one store' });
    return;
  }

  const startedAt = Date.now();
  let clientGone = false;
  res.on('close', () => {
    clientGone = true;
  });

  res.status(200);
  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  // Stop nginx from buffering the stream
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const send = (event: object) => {
    if (!clientGone) res.write(JSON.stringify(event) + '\n');
  };

  send({ type: 'start', stores: stores.map((store) => ({ id: store.id, name: store.name })) });

  try {
    await searchStores(query, stores, (result) => send({ type: 'store', result }));
    send({ type: 'done', durationMs: Date.now() - startedAt });
  } catch (error) {
    console.error('Error searching stores:', error);
    send({ type: 'error', error: 'Search failed' });
  } finally {
    res.end();
  }
});

export default router;
