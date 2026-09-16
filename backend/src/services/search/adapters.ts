import axios, { AxiosError } from 'axios';
import type { DoofinderAdapterConfig, HtmlAdapterConfig, RawOffer, StoreDefinition } from './types';
import { extractOffers } from './extract';
import { renderPage } from './browser';
import { parseAvailability, parseLocalizedPrice } from './price';

const BROWSER_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'pt-PT,pt;q=0.9,en;q=0.8',
  'Cache-Control': 'no-cache',
};

async function searchHtml(store: StoreDefinition, config: HtmlAdapterConfig, query: string): Promise<RawOffer[]> {
  const url = config.searchUrl.replace('{query}', encodeURIComponent(query));

  if (config.render === 'browser') {
    const html = await renderPage(url, config.waitFor);
    return extractOffers(html, url, store.currency, config.selectors);
  }

  let html: string;
  try {
    const response = await axios.get<string>(url, {
      headers: BROWSER_HEADERS,
      timeout: 20_000,
      maxRedirects: 5,
      responseType: 'text',
    });
    html = response.data;
  } catch (error) {
    // Same fallback as the product scraper: bot protection answers plain HTTP with
    // 403 (Cloudflare), 503 (Amazon) or 429
    if (error instanceof AxiosError && [403, 429, 503].includes(error.response?.status ?? 0)) {
      html = await renderPage(url, config.waitFor);
    } else {
      throw error;
    }
  }

  const offers = extractOffers(html, url, store.currency, config.selectors);
  if (offers.length > 0 || config.render === 'http') return offers;

  // 'auto': nothing in the static HTML, the results may be rendered client-side
  return extractOffers(await renderPage(url, config.waitFor), url, store.currency, config.selectors);
}

interface DoofinderResult {
  title?: string;
  link?: string;
  image_link?: string;
  img?: string;
  price?: string | number;
  sale_price?: string | number;
  best_price?: string | number;
  availability?: string;
  brand?: string;
  mpn?: string;
  ref?: string;
  gtin?: string;
}

async function searchDoofinder(store: StoreDefinition, config: DoofinderAdapterConfig, query: string): Promise<RawOffer[]> {
  const response = await axios.get<{ results?: DoofinderResult[] }>(
    `https://${config.zone}-search.doofinder.com/5/search`,
    {
      params: { hashid: config.hashid, query, rpp: 48 },
      // Doofinder checks the Origin against the store's allowed domains
      headers: { ...BROWSER_HEADERS, Accept: 'application/json', Origin: store.homepage, Referer: store.homepage },
      timeout: 15_000,
    }
  );

  const offers: RawOffer[] = [];
  for (const result of response.data.results || []) {
    const priceValue = result.best_price ?? result.sale_price ?? result.price;
    const parsed = parseLocalizedPrice(priceValue === undefined ? null : String(priceValue), store.currency);
    if (!result.title || !result.link || !parsed) continue;

    const url = /^https?:\/\//.test(result.link)
      ? result.link
      : (config.productUrl || `${store.homepage}/{link}`).replace('{link}', result.link);
    const image = result.image_link || result.img || null;

    offers.push({
      title: result.title,
      url,
      imageUrl: image && !/^https?:\/\//.test(image) ? new URL(image, config.imageBase || store.homepage).toString() : image,
      price: parsed.price,
      currency: parsed.currency,
      stockStatus: parseAvailability(result.availability),
      brand: result.brand || null,
      sku: result.mpn || result.ref || null,
      // Some feeds list every EAN of the product family; the first one is the product itself
      gtin: result.gtin?.split(',')[0]?.trim() || null,
    });
  }
  return offers;
}

export function runAdapter(store: StoreDefinition, query: string): Promise<RawOffer[]> {
  switch (store.adapter.type) {
    case 'html':
      return searchHtml(store, store.adapter, query);
    case 'doofinder':
      return searchDoofinder(store, store.adapter, query);
  }
}
