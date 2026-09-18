import type { StoreDefinition } from './types';

export const REGIONS: Record<string, string> = {
  PT: 'Portugal',
  ES: 'Spain',
};

/**
 * Built-in stores. Adding a store is usually just a new entry here:
 * - stores exposing schema.org JSON-LD or microdata on their search page need only `searchUrl`
 * - otherwise add CSS `selectors`
 * - stores using a hosted search provider (e.g. Doofinder) use that adapter instead
 */
export const STORES: StoreDefinition[] = [
  {
    id: 'worten',
    name: 'Worten',
    homepage: 'https://www.worten.pt',
    regions: ['PT'],
    currency: 'EUR',
    adapter: {
      type: 'html',
      searchUrl: 'https://www.worten.pt/search?query={query}',
      // Cloudflare blocks plain HTTP; the rendered page carries a JSON-LD ItemList
      render: 'browser',
      waitFor: '.product-card',
    },
  },
  {
    id: 'radiopopular',
    name: 'Radio Popular',
    homepage: 'https://www.radiopopular.pt',
    regions: ['PT'],
    currency: 'EUR',
    adapter: {
      type: 'html',
      searchUrl: 'https://www.radiopopular.pt/pesquisa/{query}',
      render: 'http',
    },
  },
  {
    id: 'globaldata',
    name: 'Globaldata',
    homepage: 'https://www.globaldata.pt',
    regions: ['PT'],
    currency: 'EUR',
    adapter: {
      type: 'html',
      searchUrl: 'https://www.globaldata.pt/search?q={query}',
      render: 'http',
      selectors: {
        item: '.product-tile',
        title: '.product-tile-product-name a',
        link: '.product-tile-product-name a',
        price: '.sales .value',
        priceAttr: 'content',
        image: 'img',
        outOfStock: '.product-availability-message-out-of-stock',
      },
    },
  },
  {
    id: 'continente',
    name: 'Continente',
    homepage: 'https://www.continente.pt',
    regions: ['PT'],
    currency: 'EUR',
    adapter: {
      type: 'html',
      searchUrl: 'https://www.continente.pt/pesquisa/?q={query}',
      render: 'http',
      selectors: {
        item: '[data-product-tile-impression]',
        title: '.pwc-tile--description',
        link: '.ct-pdp-link a',
        price: '.pwc-tile--price-primary',
        image: 'img',
      },
    },
  },
  {
    id: 'castro',
    name: 'Castro Electrónica',
    homepage: 'https://www.castroelectronica.pt',
    regions: ['PT'],
    currency: 'EUR',
    adapter: {
      type: 'doofinder',
      hashid: '10dbf5055ebc60fe31ec7a66eff8ca02',
      zone: 'eu1',
      productUrl: 'https://www.castroelectronica.pt/product/{link}',
    },
  },
  {
    id: 'amazon-es',
    name: 'Amazon.es',
    homepage: 'https://www.amazon.es',
    regions: ['ES', 'PT'],
    currency: 'EUR',
    adapter: {
      type: 'html',
      searchUrl: 'https://www.amazon.es/s?k={query}',
      render: 'http',
      selectors: {
        item: 'div[data-component-type="s-search-result"]',
        title: 'h2',
        link: 'a[href*="/dp/"]',
        price: '.a-price:not(.a-text-price) .a-offscreen',
        image: 'img.s-image',
      },
    },
  },
];

export function getStore(id: string): StoreDefinition | undefined {
  return STORES.find((store) => store.id === id);
}
