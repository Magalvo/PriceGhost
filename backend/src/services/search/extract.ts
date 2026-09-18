import { load, type CheerioAPI } from 'cheerio';
import type { HtmlSelectors, RawOffer } from './types';
import { parseAvailability, parseLocalizedPrice } from './price';

type Json = Record<string, unknown>;

function absoluteUrl(href: string | null | undefined, baseUrl: string): string | null {
  if (!href) return null;
  try {
    return new URL(href.trim(), baseUrl).toString();
  } catch {
    return null;
  }
}

function asArray<T>(value: T | T[] | undefined | null): T[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function hasType(node: Json, type: string): boolean {
  return asArray(node['@type'] as string | string[]).some(
    (t) => typeof t === 'string' && t.toLowerCase() === type.toLowerCase()
  );
}

function textOf(value: unknown): string | null {
  if (typeof value === 'string') return value.trim() || null;
  if (typeof value === 'number') return String(value);
  if (value && typeof value === 'object' && 'name' in value) return textOf((value as Json).name);
  return null;
}

function imageOf(value: unknown): string | null {
  const first = asArray(value as unknown[])[0];
  if (typeof first === 'string') return first;
  if (first && typeof first === 'object') return textOf((first as Json).url) || textOf((first as Json).contentUrl);
  return null;
}

// Collect every schema.org Product node, including ones nested in ItemList / @graph
function collectJsonLdProducts(node: unknown, out: Json[], depth = 0): void {
  if (!node || typeof node !== 'object' || depth > 6) return;
  if (Array.isArray(node)) {
    node.forEach((child) => collectJsonLdProducts(child, out, depth + 1));
    return;
  }
  const obj = node as Json;
  if (hasType(obj, 'Product') || hasType(obj, 'ProductGroup')) {
    out.push(obj);
    return;
  }
  for (const key of ['@graph', 'itemListElement', 'item', 'mainEntity']) {
    if (key in obj) collectJsonLdProducts(obj[key], out, depth + 1);
  }
}

function offerFromJsonLd(product: Json, baseUrl: string, fallbackCurrency: string): RawOffer | null {
  const title = textOf(product.name);
  const url = absoluteUrl(textOf(product.url) || textOf(product['@id']), baseUrl);
  if (!title || !url) return null;

  // offers may be an Offer, an AggregateOffer or a list; hasVariant covers ProductGroup
  const offers = asArray(product.offers as Json | Json[]);
  if (offers.length === 0) {
    for (const variant of asArray(product.hasVariant as Json | Json[])) {
      offers.push(...asArray(variant.offers as Json | Json[]));
    }
  }

  let best: { price: number; currency: string; availability: unknown } | null = null;
  for (const offer of offers) {
    const spec = offer.priceSpecification as Json | undefined;
    const raw = offer.lowPrice ?? offer.price ?? spec?.price;
    const currency = textOf(offer.priceCurrency) || textOf(spec?.priceCurrency) || fallbackCurrency;
    const parsed = typeof raw === 'number' ? { price: raw, currency } : parseLocalizedPrice(textOf(raw), currency);
    if (parsed && parsed.price > 0 && (!best || parsed.price < best.price)) {
      best = { price: parsed.price, currency, availability: offer.availability };
    }
  }
  if (!best) return null;

  return {
    title,
    url,
    imageUrl: absoluteUrl(imageOf(product.image), baseUrl),
    price: best.price,
    currency: best.currency,
    stockStatus: parseAvailability(best.availability),
    brand: textOf(product.brand),
    sku: textOf(product.sku),
    gtin: textOf(product.gtin13) || textOf(product.gtin) || textOf(product.gtin14) || textOf(product.gtin8),
  };
}

function extractJsonLd($: CheerioAPI, baseUrl: string, fallbackCurrency: string): RawOffer[] {
  const products: Json[] = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      collectJsonLdProducts(JSON.parse($(el).text()), products);
    } catch {
      // Malformed JSON-LD is common; skip the block
    }
  });
  return products
    .map((product) => offerFromJsonLd(product, baseUrl, fallbackCurrency))
    .filter((offer): offer is RawOffer => offer !== null);
}

function extractMicrodata($: CheerioAPI, baseUrl: string, fallbackCurrency: string): RawOffer[] {
  const offers: RawOffer[] = [];
  $('[itemscope][itemtype*="schema.org/Product"]').each((_, el) => {
    const $product = $(el);
    // Only read properties that belong to this product, not to a nested Product
    const prop = (name: string) =>
      $product.find(`[itemprop="${name}"]`).filter((_, p) => $(p).closest('[itemtype*="schema.org/Product"]').is(el)).first();
    const value = ($el: ReturnType<typeof prop>) =>
      $el.attr('content') || $el.attr('href') || $el.attr('src') || $el.text().trim() || null;

    const priceEl = prop('price').length ? prop('price') : prop('lowPrice');
    const currency = value(prop('priceCurrency')) || fallbackCurrency;
    const parsed = parseLocalizedPrice(value(priceEl), currency);
    const title = value(prop('name')) || $product.find('a[title]').first().attr('title') || null;
    const url = absoluteUrl(value(prop('url')) || $product.find('a[href]').first().attr('href'), baseUrl);
    if (!parsed || !title || !url) return;

    offers.push({
      title,
      url,
      imageUrl: absoluteUrl(value(prop('image')), baseUrl),
      price: parsed.price,
      currency: parsed.currency,
      stockStatus: parseAvailability(value(prop('availability'))),
      brand: value(prop('brand')),
      sku: value(prop('sku')),
      gtin: value(prop('gtin13')) || value(prop('gtin')),
    });
  });
  return offers;
}

function imageFromElement($img: ReturnType<CheerioAPI>): string | null {
  const srcset = $img.attr('data-srcset') || $img.attr('srcset');
  const candidates = [
    $img.attr('data-src'),
    $img.attr('data-lazy-src'),
    srcset?.split(',')[0]?.trim().split(' ')[0],
    $img.attr('src'),
  ];
  const src = candidates.find((c) => c && !c.startsWith('data:') && !/1x1|placeholder|blank\./i.test(c));
  if (src) return src;
  const style = $img.attr('style') || '';
  return style.match(/url\(['"]?([^'")]+)['"]?\)/)?.[1] || null;
}

export function extractWithSelectors(
  $: CheerioAPI,
  selectors: HtmlSelectors,
  baseUrl: string,
  fallbackCurrency: string
): RawOffer[] {
  const offers: RawOffer[] = [];
  $(selectors.item).each((_, el) => {
    const $item = $(el);
    const $title = $item.find(selectors.title).first();
    const title = ($title.text().trim() || $title.attr('title') || '').replace(/\s+/g, ' ');

    const $link = selectors.link ? $item.find(selectors.link).first() : $item.find('a[href]').first();
    const url = absoluteUrl($link.attr('href') || $item.attr('href'), baseUrl);

    const $price = $item.find(selectors.price).first();
    const priceText = selectors.priceAttr ? $price.attr(selectors.priceAttr) : $price.text();
    // Attribute values are usually bare numbers, so take the currency from the visible text
    const parsed = parseLocalizedPrice(priceText, fallbackCurrency);

    if (!title || !url || !parsed) return;

    const $img = selectors.image ? $item.find(selectors.image).first() : $item.find('img').first();
    offers.push({
      title,
      url,
      imageUrl: absoluteUrl(imageFromElement($img), baseUrl),
      price: parsed.price,
      currency: selectors.priceAttr ? fallbackCurrency : parsed.currency,
      stockStatus: selectors.outOfStock
        ? $item.find(selectors.outOfStock).length > 0 ? 'out_of_stock' : 'in_stock'
        : 'unknown',
      brand: null,
      sku: null,
      gtin: null,
    });
  });
  return offers;
}

/**
 * Read search results from an HTML page. Configured selectors win; otherwise schema.org
 * JSON-LD is tried first, then microdata.
 */
export function extractOffers(
  html: string,
  baseUrl: string,
  fallbackCurrency: string,
  selectors?: HtmlSelectors
): RawOffer[] {
  const $ = load(html);
  if (selectors) return extractWithSelectors($, selectors, baseUrl, fallbackCurrency);

  const jsonLd = extractJsonLd($, baseUrl, fallbackCurrency);
  if (jsonLd.length > 0) return jsonLd;
  return extractMicrodata($, baseUrl, fallbackCurrency);
}
