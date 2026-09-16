import type { SearchOffer, StoreDefinition, StoreSearchResult } from './types';
import { runAdapter } from './adapters';
import { detectCondition, scoreRelevance, tokenize } from './relevance';

const STORE_TIMEOUT_MS = 60_000;
const CACHE_TTL_MS = 10 * 60_000;
const CACHE_MAX_ENTRIES = 500;
const MAX_OFFERS_PER_STORE = 30;

// Results per store+query, so refining filters or re-running a search doesn't hit stores again
const cache = new Map<string, { expiresAt: number; offers: SearchOffer[] }>();

function cacheKey(storeId: string, query: string): string {
  return `${storeId}|${tokenize(query).join(' ')}`;
}

function readCache(key: string): SearchOffer[] | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    cache.delete(key);
    return null;
  }
  return entry.offers;
}

function writeCache(key: string, offers: SearchOffer[]): void {
  if (cache.size >= CACHE_MAX_ENTRIES) {
    // Map iterates in insertion order, so the first key is the oldest
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, offers });
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out after ${ms / 1000}s`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

async function searchStore(store: StoreDefinition, query: string): Promise<StoreSearchResult> {
  const startedAt = Date.now();
  const key = cacheKey(store.id, query);
  const cached = readCache(key);
  if (cached) {
    return { storeId: store.id, storeName: store.name, status: 'ok', offers: cached, durationMs: 0, cached: true };
  }

  try {
    const queryTokens = tokenize(query);
    const rawOffers = await withTimeout(runAdapter(store, query), STORE_TIMEOUT_MS);

    const seen = new Set<string>();
    const offers: SearchOffer[] = [];
    for (const raw of rawOffers) {
      if (seen.has(raw.url)) continue;
      seen.add(raw.url);
      offers.push({
        ...raw,
        storeId: store.id,
        storeName: store.name,
        condition: detectCondition(raw.title),
        relevance: scoreRelevance(queryTokens, raw.title),
      });
    }
    offers.sort((a, b) => b.relevance - a.relevance || a.price - b.price);
    const limited = offers.slice(0, MAX_OFFERS_PER_STORE);

    writeCache(key, limited);
    console.log(`[Search] ${store.name}: ${limited.length} offers for "${query}" in ${Date.now() - startedAt}ms`);
    return { storeId: store.id, storeName: store.name, status: 'ok', offers: limited, durationMs: Date.now() - startedAt, cached: false };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[Search] ${store.name} failed for "${query}": ${message}`);
    return {
      storeId: store.id,
      storeName: store.name,
      status: 'error',
      offers: [],
      error: message,
      durationMs: Date.now() - startedAt,
      cached: false,
    };
  }
}

/**
 * Search all given stores in parallel, reporting each store's result as soon as it arrives
 * so fast stores aren't held back by ones that need a headless browser.
 */
export async function searchStores(
  query: string,
  stores: StoreDefinition[],
  onResult: (result: StoreSearchResult) => void
): Promise<void> {
  await Promise.all(stores.map(async (store) => onResult(await searchStore(store, query))));
}
