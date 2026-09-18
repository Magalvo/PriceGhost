import { useState, useEffect, useMemo, useRef, FormEvent } from 'react';
import Layout from '../components/Layout';
import PriceSelectionModal from '../components/PriceSelectionModal';
import { useToast } from '../context/ToastContext';
import {
  searchApi,
  productsApi,
  SearchOffer,
  SearchRegion,
  SearchStore,
  StoreSearchResult,
  PriceReviewResponse,
  Product,
} from '../api/client';

type SortOption = 'price_asc' | 'price_desc' | 'relevance' | 'store';

interface StoreProgress {
  id: string;
  name: string;
  result: StoreSearchResult | null;
}

const ALL_REGIONS = 'ALL';

function readStorage<T>(key: string, fallback: T): T {
  try {
    const saved = localStorage.getItem(key);
    return saved ? (JSON.parse(saved) as T) : fallback;
  } catch {
    return fallback;
  }
}

function formatPrice(price: number, currency: string) {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(price);
  } catch {
    return `${price.toFixed(2)} ${currency}`;
  }
}

function isPriceReviewResponse(response: Product | PriceReviewResponse): response is PriceReviewResponse {
  return 'needsReview' in response && response.needsReview === true;
}

export default function Search() {
  const { showToast } = useToast();

  const [regions, setRegions] = useState<SearchRegion[]>([]);
  const [stores, setStores] = useState<SearchStore[]>([]);
  const [region, setRegion] = useState<string>(() => readStorage('search_region', ALL_REGIONS));
  const [disabledStores, setDisabledStores] = useState<string[]>(() => readStorage('search_disabled_stores', []));

  const [query, setQuery] = useState('');
  const [lastQuery, setLastQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [progress, setProgress] = useState<StoreProgress[]>([]);
  const [error, setError] = useState('');
  const abortRef = useRef<AbortController | null>(null);

  const [sortBy, setSortBy] = useState<SortOption>('price_asc');
  const [inStockOnly, setInStockOnly] = useState(false);
  const [includePartial, setIncludePartial] = useState(false);
  const [includeRefurbished, setIncludeRefurbished] = useState(false);
  const [minPrice, setMinPrice] = useState('');
  const [maxPrice, setMaxPrice] = useState('');
  const [hiddenResultStores, setHiddenResultStores] = useState<Set<string>>(new Set());

  const [trackingUrl, setTrackingUrl] = useState<string | null>(null);
  const [trackedUrls, setTrackedUrls] = useState<Set<string>>(new Set());
  const [priceReviewData, setPriceReviewData] = useState<PriceReviewResponse | null>(null);

  useEffect(() => {
    searchApi
      .getStores()
      .then((response) => {
        setRegions(response.data.regions);
        setStores(response.data.stores);
        // A remembered region may have been removed from the store registry
        setRegion((current) =>
          response.data.regions.some((r) => r.code === current) ? current : ALL_REGIONS
        );
      })
      .catch(() => setError('Failed to load stores'));
    return () => abortRef.current?.abort();
  }, []);

  useEffect(() => {
    localStorage.setItem('search_region', JSON.stringify(region));
  }, [region]);

  useEffect(() => {
    localStorage.setItem('search_disabled_stores', JSON.stringify(disabledStores));
  }, [disabledStores]);

  const regionStores = useMemo(
    () => (region === ALL_REGIONS ? stores : stores.filter((s) => s.regions.includes(region))),
    [stores, region]
  );
  const selectedStores = regionStores.filter((s) => !disabledStores.includes(s.id));

  const toggleStore = (id: string) => {
    setDisabledStores((prev) => (prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]));
  };

  const handleSearch = async (e: FormEvent) => {
    e.preventDefault();
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setError('Enter at least 2 characters');
      return;
    }
    if (selectedStores.length === 0) {
      setError('Select at least one store');
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setError('');
    setIsSearching(true);
    setLastQuery(trimmed);
    setHiddenResultStores(new Set());
    // Refurbished listings are hidden by default, unless that's what the user is looking for
    setIncludeRefurbished(/recondicion|reacondicion|refurb|renewed|usad[oa]|seminov/i.test(trimmed));
    setProgress(selectedStores.map((s) => ({ id: s.id, name: s.name, result: null })));

    try {
      await searchApi.search(
        trimmed,
        selectedStores.map((s) => s.id),
        (event) => {
          if (event.type === 'store') {
            setProgress((prev) => prev.map((p) => (p.id === event.result.storeId ? { ...p, result: event.result } : p)));
          } else if (event.type === 'error') {
            setError(event.error);
          }
        },
        controller.signal
      );
    } catch (err) {
      if (!controller.signal.aborted) {
        setError(err instanceof Error ? err.message : 'Search failed');
      }
    } finally {
      if (abortRef.current === controller) {
        setIsSearching(false);
      }
    }
  };

  const allOffers = useMemo(() => progress.flatMap((p) => p.result?.offers || []), [progress]);

  const { offers, partialCount, refurbishedCount } = useMemo(() => {
    const min = parseFloat(minPrice);
    const max = parseFloat(maxPrice);
    let partial = 0;
    let refurbished = 0;

    const filtered = allOffers.filter((offer) => {
      if (hiddenResultStores.has(offer.storeId)) return false;
      if (inStockOnly && offer.stockStatus === 'out_of_stock') return false;
      if (!isNaN(min) && offer.price < min) return false;
      if (!isNaN(max) && offer.price > max) return false;
      if (offer.relevance < 1 && !includePartial) {
        partial++;
        return false;
      }
      if (offer.condition === 'refurbished' && !includeRefurbished) {
        refurbished++;
        return false;
      }
      return true;
    });

    filtered.sort((a, b) => {
      switch (sortBy) {
        case 'price_asc':
          return a.price - b.price;
        case 'price_desc':
          return b.price - a.price;
        case 'relevance':
          return b.relevance - a.relevance || a.price - b.price;
        case 'store':
          return a.storeName.localeCompare(b.storeName) || a.price - b.price;
      }
    });

    return { offers: filtered, partialCount: partial, refurbishedCount: refurbished };
  }, [allOffers, hiddenResultStores, inStockOnly, minPrice, maxPrice, includePartial, includeRefurbished, sortBy]);

  // Only compare prices within one currency; mixed-currency results are rare (regions differ)
  const bestOffer = useMemo(() => {
    const available = offers.filter((o) => o.stockStatus !== 'out_of_stock');
    const pool = available.length > 0 ? available : offers;
    return pool.reduce<SearchOffer | null>((best, o) => (!best || o.price < best.price ? o : best), null);
  }, [offers]);

  const toggleResultStore = (id: string) => {
    setHiddenResultStores((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const markTracked = (url: string) => setTrackedUrls((prev) => new Set(prev).add(url));

  const handleTrack = async (offer: SearchOffer) => {
    setTrackingUrl(offer.url);
    try {
      const response = await productsApi.create(offer.url);
      if (isPriceReviewResponse(response.data)) {
        setPriceReviewData(response.data);
      } else {
        markTracked(offer.url);
        showToast('Product added to your dashboard');
      }
    } catch (err) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const axiosError = err as any;
      if (axiosError.response?.status === 409) {
        markTracked(offer.url);
        showToast('You are already tracking this product', 'info');
      } else {
        showToast(axiosError.response?.data?.error || 'Failed to track product', 'error');
      }
    } finally {
      setTrackingUrl(null);
    }
  };

  const handlePriceSelected = async (price: number, method: string, currency: string) => {
    if (!priceReviewData) return;
    try {
      await productsApi.create(priceReviewData.url, undefined, price, method, currency);
      markTracked(priceReviewData.url);
      showToast('Product added to your dashboard');
      setPriceReviewData(null);
    } catch (err) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const axiosError = err as any;
      showToast(axiosError.response?.data?.error || 'Failed to track product', 'error');
    }
  };

  const doneCount = progress.filter((p) => p.result).length;

  return (
    <Layout>
      <style>{`
        .search-page-header {
          margin-bottom: 1.5rem;
        }

        .search-page-title {
          font-size: 1.75rem;
          font-weight: 700;
          color: var(--text);
        }

        .search-page-subtitle {
          color: var(--text-muted);
          margin-top: 0.25rem;
        }

        .search-panel {
          background: var(--surface);
          border-radius: 0.75rem;
          padding: 1.5rem;
          box-shadow: var(--shadow);
          margin-bottom: 1.5rem;
        }

        .search-panel-row {
          display: grid;
          gap: 1rem;
          grid-template-columns: 1fr auto auto;
          align-items: end;
        }

        .store-picker {
          display: flex;
          flex-wrap: wrap;
          gap: 0.5rem;
          margin-top: 1rem;
          align-items: center;
        }

        .store-picker-label {
          font-size: 0.8125rem;
          color: var(--text-muted);
          margin-right: 0.25rem;
        }

        .chip {
          display: inline-flex;
          align-items: center;
          gap: 0.375rem;
          padding: 0.375rem 0.75rem;
          border-radius: 9999px;
          border: 1px solid var(--border);
          background: var(--background);
          color: var(--text-muted);
          font-size: 0.8125rem;
          cursor: pointer;
          transition: all 0.2s;
        }

        .chip:hover {
          border-color: var(--primary);
        }

        .chip.active {
          border-color: var(--primary);
          background: rgba(99, 102, 241, 0.1);
          color: var(--text);
        }

        .chip.error {
          border-color: var(--danger);
          color: var(--danger);
        }

        .chip .spinner {
          width: 0.75rem;
          height: 0.75rem;
          border-width: 2px;
        }

        .store-status {
          display: flex;
          flex-wrap: wrap;
          gap: 0.5rem;
          margin-bottom: 1rem;
        }

        .results-toolbar {
          display: flex;
          flex-wrap: wrap;
          gap: 0.75rem;
          align-items: center;
          margin-bottom: 1rem;
        }

        .results-toolbar select,
        .results-toolbar input[type="number"] {
          padding: 0.5rem 0.75rem;
          border: 1px solid var(--border);
          border-radius: 0.5rem;
          background: var(--surface);
          color: var(--text);
          font-size: 0.875rem;
        }

        .results-toolbar input[type="number"] {
          width: 6.5rem;
        }

        .results-toolbar label {
          display: inline-flex;
          align-items: center;
          gap: 0.375rem;
          font-size: 0.875rem;
          color: var(--text);
          cursor: pointer;
          margin: 0;
        }

        .results-count {
          color: var(--text-muted);
          font-size: 0.875rem;
          margin-bottom: 0.75rem;
        }

        .best-offer {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 1rem;
          flex-wrap: wrap;
          background: var(--surface);
          border: 2px solid var(--secondary);
          border-radius: 0.75rem;
          padding: 1rem 1.25rem;
          margin-bottom: 1rem;
        }

        .best-offer-label {
          font-size: 0.75rem;
          font-weight: 600;
          text-transform: uppercase;
          color: var(--secondary);
        }

        .best-offer-price {
          font-size: 1.5rem;
          font-weight: 700;
          color: var(--text);
        }

        .best-offer-store {
          color: var(--text-muted);
          font-size: 0.875rem;
        }

        .offer-list {
          display: flex;
          flex-direction: column;
          gap: 0.75rem;
        }

        .offer-row {
          display: grid;
          grid-template-columns: 72px 1fr auto;
          gap: 1rem;
          align-items: center;
          background: var(--surface);
          border-radius: 0.75rem;
          box-shadow: var(--shadow);
          padding: 0.875rem 1rem;
        }

        .offer-image {
          width: 72px;
          height: 72px;
          object-fit: contain;
          border-radius: 0.5rem;
          background: white;
        }

        .offer-image-placeholder {
          width: 72px;
          height: 72px;
          border-radius: 0.5rem;
          background: var(--background);
        }

        .offer-info {
          min-width: 0;
        }

        .offer-title {
          color: var(--text);
          font-weight: 500;
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }

        .offer-meta {
          display: flex;
          flex-wrap: wrap;
          gap: 0.5rem;
          align-items: center;
          margin-top: 0.375rem;
          font-size: 0.8125rem;
          color: var(--text-muted);
        }

        .offer-badge {
          padding: 0.125rem 0.5rem;
          border-radius: 9999px;
          font-size: 0.75rem;
          font-weight: 500;
          background: var(--background);
        }

        .offer-badge.in-stock {
          color: #10b981;
        }

        .offer-badge.out-of-stock {
          color: var(--danger);
        }

        .offer-badge.best {
          background: var(--secondary);
          color: white;
        }

        .offer-side {
          display: flex;
          flex-direction: column;
          align-items: flex-end;
          gap: 0.5rem;
        }

        .offer-price {
          font-size: 1.25rem;
          font-weight: 700;
          color: var(--text);
          white-space: nowrap;
        }

        .offer-actions {
          display: flex;
          gap: 0.5rem;
        }

        .offer-actions .btn {
          padding: 0.375rem 0.75rem;
          font-size: 0.8125rem;
        }

        .search-empty {
          text-align: center;
          padding: 3rem 2rem;
          background: var(--surface);
          border-radius: 0.75rem;
          box-shadow: var(--shadow);
          color: var(--text-muted);
        }

        @media (max-width: 768px) {
          .search-panel-row {
            grid-template-columns: 1fr;
          }

          .offer-row {
            grid-template-columns: 56px 1fr;
          }

          .offer-image, .offer-image-placeholder {
            width: 56px;
            height: 56px;
          }

          .offer-side {
            grid-column: 1 / -1;
            flex-direction: row;
            justify-content: space-between;
            align-items: center;
          }
        }
      `}</style>

      <div className="search-page-header">
        <h1 className="search-page-title">Compare Prices</h1>
        <p className="search-page-subtitle">Search for a product across stores and find the best price</p>
      </div>

      <div className="search-panel">
        {error && <div className="alert alert-error mb-3">{error}</div>}

        <form onSubmit={handleSearch}>
          <div className="search-panel-row">
            <div className="form-group" style={{ margin: 0 }}>
              <label htmlFor="search-query">Product</label>
              <input
                id="search-query"
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="e.g. iPhone 15 128GB"
                maxLength={100}
                autoFocus
              />
            </div>

            <div className="form-group" style={{ margin: 0 }}>
              <label htmlFor="search-region">Region</label>
              <select id="search-region" value={region} onChange={(e) => setRegion(e.target.value)}>
                <option value={ALL_REGIONS}>All regions</option>
                {regions.map((r) => (
                  <option key={r.code} value={r.code}>
                    {r.name}
                  </option>
                ))}
              </select>
            </div>

            <button type="submit" className="btn btn-primary" disabled={isSearching} style={{ height: '46px' }}>
              {isSearching ? <span className="spinner" /> : 'Search'}
            </button>
          </div>
        </form>

        <div className="store-picker">
          <span className="store-picker-label">Stores:</span>
          {regionStores.map((store) => (
            <button
              key={store.id}
              type="button"
              className={`chip ${disabledStores.includes(store.id) ? '' : 'active'}`}
              onClick={() => toggleStore(store.id)}
              title={store.homepage}
            >
              {store.name}
            </button>
          ))}
        </div>
      </div>

      {progress.length > 0 && (
        <>
          <div className="store-status">
            {progress.map((p) => {
              const failed = p.result?.status === 'error';
              const hidden = hiddenResultStores.has(p.id);
              return (
                <button
                  key={p.id}
                  type="button"
                  className={`chip ${failed ? 'error' : hidden ? '' : 'active'}`}
                  onClick={() => p.result && !failed && toggleResultStore(p.id)}
                  title={failed ? p.result?.error : p.result ? 'Click to show/hide this store' : 'Searching...'}
                >
                  {!p.result && <span className="spinner" />}
                  {p.name}
                  {p.result && !failed && ` · ${p.result.offers.length}`}
                  {failed && ' · failed'}
                </button>
              );
            })}
          </div>

          <div className="results-toolbar">
            <select value={sortBy} onChange={(e) => setSortBy(e.target.value as SortOption)}>
              <option value="price_asc">Lowest price</option>
              <option value="price_desc">Highest price</option>
              <option value="relevance">Best match</option>
              <option value="store">Store</option>
            </select>
            <input
              type="number"
              min="0"
              step="0.01"
              placeholder="Min price"
              value={minPrice}
              onChange={(e) => setMinPrice(e.target.value)}
            />
            <input
              type="number"
              min="0"
              step="0.01"
              placeholder="Max price"
              value={maxPrice}
              onChange={(e) => setMaxPrice(e.target.value)}
            />
            <label>
              <input type="checkbox" checked={inStockOnly} onChange={(e) => setInStockOnly(e.target.checked)} />
              In stock only
            </label>
            <label>
              <input type="checkbox" checked={includePartial} onChange={(e) => setIncludePartial(e.target.checked)} />
              Include partial matches
            </label>
            <label>
              <input type="checkbox" checked={includeRefurbished} onChange={(e) => setIncludeRefurbished(e.target.checked)} />
              Include refurbished
            </label>
          </div>

          {bestOffer && (
            <div className="best-offer">
              <div>
                <div className="best-offer-label">Best price</div>
                <div className="best-offer-price">{formatPrice(bestOffer.price, bestOffer.currency)}</div>
                <div className="best-offer-store">
                  at {bestOffer.storeName} · {bestOffer.title}
                </div>
              </div>
              <a className="btn btn-secondary" href={bestOffer.url} target="_blank" rel="noopener noreferrer">
                Visit store
              </a>
            </div>
          )}

          <p className="results-count">
            {offers.length} result{offers.length !== 1 ? 's' : ''} for "{lastQuery}"
            {isSearching && ` · waiting for ${progress.length - doneCount} store${progress.length - doneCount !== 1 ? 's' : ''}`}
            {partialCount > 0 && !includePartial && ` · ${partialCount} partial match${partialCount !== 1 ? 'es' : ''} hidden`}
            {refurbishedCount > 0 && !includeRefurbished && ` · ${refurbishedCount} refurbished hidden`}
          </p>

          {offers.length === 0 && !isSearching ? (
            <div className="search-empty">
              {partialCount > 0 || refurbishedCount > 0
                ? 'No matching new products. Try including partial matches or refurbished listings.'
                : 'No products found. Try a different search or more stores.'}
            </div>
          ) : (
            <div className="offer-list">
              {offers.map((offer) => (
                <div key={offer.url} className="offer-row">
                  {offer.imageUrl ? (
                    <img className="offer-image" src={offer.imageUrl} alt="" loading="lazy" referrerPolicy="no-referrer" />
                  ) : (
                    <div className="offer-image-placeholder" />
                  )}
                  <div className="offer-info">
                    <a className="offer-title" href={offer.url} target="_blank" rel="noopener noreferrer">
                      {offer.title}
                    </a>
                    <div className="offer-meta">
                      <span>{offer.storeName}</span>
                      {offer === bestOffer && <span className="offer-badge best">Best price</span>}
                      {offer.stockStatus === 'in_stock' && <span className="offer-badge in-stock">In stock</span>}
                      {offer.stockStatus === 'out_of_stock' && <span className="offer-badge out-of-stock">Out of stock</span>}
                      {offer.condition === 'refurbished' && <span className="offer-badge">Refurbished</span>}
                      {offer.relevance < 1 && <span className="offer-badge">Partial match</span>}
                    </div>
                  </div>
                  <div className="offer-side">
                    <span className="offer-price">{formatPrice(offer.price, offer.currency)}</span>
                    <div className="offer-actions">
                      <a className="btn btn-secondary" href={offer.url} target="_blank" rel="noopener noreferrer">
                        Visit
                      </a>
                      <button
                        className="btn btn-primary"
                        onClick={() => handleTrack(offer)}
                        disabled={trackingUrl !== null || trackedUrls.has(offer.url)}
                      >
                        {trackingUrl === offer.url ? <span className="spinner" /> : trackedUrls.has(offer.url) ? 'Tracking' : 'Track'}
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {priceReviewData && (
        <PriceSelectionModal
          isOpen={true}
          onClose={() => setPriceReviewData(null)}
          onSelect={handlePriceSelected}
          productName={priceReviewData.name}
          imageUrl={priceReviewData.imageUrl}
          candidates={priceReviewData.priceCandidates}
          suggestedPrice={priceReviewData.suggestedPrice}
          url={priceReviewData.url}
        />
      )}
    </Layout>
  );
}
