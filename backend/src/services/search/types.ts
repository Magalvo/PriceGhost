import type { StockStatus } from '../scraper';

// A single product listing returned by a store's search
export interface SearchOffer {
  storeId: string;
  storeName: string;
  title: string;
  url: string;
  imageUrl: string | null;
  price: number;
  currency: string;
  stockStatus: StockStatus;
  brand: string | null;
  sku: string | null;
  gtin: string | null;
  condition: 'new' | 'refurbished'; // detected from the title
  relevance: number; // 0-1, how well the title matches the query
}

// Offer as extracted by an adapter, before store info, condition and relevance are attached
export type RawOffer = Omit<SearchOffer, 'storeId' | 'storeName' | 'condition' | 'relevance'>;

// CSS selectors for stores whose result pages have no usable structured data.
// All selectors except `item` are relative to the item element.
export interface HtmlSelectors {
  item: string;
  title: string;
  link?: string; // defaults to the first a[href] in the item
  price: string;
  priceAttr?: string; // read the price from this attribute instead of the text
  image?: string;
  outOfStock?: string; // element present => out of stock
}

export interface HtmlAdapterConfig {
  type: 'html';
  // Search page URL, `{query}` is replaced with the URL-encoded query
  searchUrl: string;
  // 'http': plain request (headless Chrome only if blocked with a 403)
  // 'browser': always render with headless Chrome (bot protection / client-side rendering)
  // 'auto' (default): like 'http', but also renders when the static HTML has no results
  render?: 'http' | 'browser' | 'auto';
  // Selector that signals results have rendered (browser mode only)
  waitFor?: string;
  // Without selectors, offers are read from JSON-LD / schema.org microdata
  selectors?: HtmlSelectors;
}

export interface DoofinderAdapterConfig {
  type: 'doofinder';
  hashid: string;
  zone: string; // e.g. 'eu1'
  // Absolute product URL template; `{link}` is replaced with the result's link field
  productUrl?: string;
  // Prefix for relative image paths
  imageBase?: string;
}

export type StoreAdapterConfig = HtmlAdapterConfig | DoofinderAdapterConfig;

export interface StoreDefinition {
  id: string;
  name: string;
  homepage: string;
  // ISO 3166-1 alpha-2 codes of the regions this store ships to
  regions: string[];
  currency: string;
  adapter: StoreAdapterConfig;
}

export interface StoreSearchResult {
  storeId: string;
  storeName: string;
  status: 'ok' | 'error';
  offers: SearchOffer[];
  error?: string;
  durationMs: number;
  cached: boolean;
}
