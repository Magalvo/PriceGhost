const SYMBOL_CURRENCIES: Record<string, string> = {
  '€': 'EUR',
  '£': 'GBP',
  '$': 'USD',
  '¥': 'JPY',
  '₹': 'INR',
};

const CODE_PATTERN = /\b(EUR|GBP|USD|CHF|CAD|AUD|JPY|INR|SEK|NOK|DKK|PLN)\b/i;

export function detectCurrency(text: string, fallback: string): string {
  const code = text.match(CODE_PATTERN);
  if (code) return code[1].toUpperCase();
  const symbol = text.match(/[€£$¥₹]/);
  if (symbol) return SYMBOL_CURRENCIES[symbol[0]];
  return fallback;
}

/**
 * Parse a price written in either European (1.234,56) or US (1,234.56) notation.
 * Unlike utils/priceParser, the currency symbol may appear after the number ("699,99 €"),
 * which is the norm in most European stores.
 */
export function parseLocalizedPrice(
  text: string | null | undefined,
  fallbackCurrency: string
): { price: number; currency: string } | null {
  if (!text) return null;
  const clean = text.replace(/[  ]/g, ' ').trim();
  const match = clean.match(/\d[\d.,\s]*/);
  if (!match) return null;

  let digits = match[0].replace(/\s/g, '').replace(/[.,]$/, '');
  const lastComma = digits.lastIndexOf(',');
  const lastDot = digits.lastIndexOf('.');

  if (lastComma !== -1 && lastDot !== -1) {
    // Both separators present: whichever comes last is the decimal separator
    const decimal = lastComma > lastDot ? ',' : '.';
    const thousands = decimal === ',' ? '.' : ',';
    digits = digits.split(thousands).join('').replace(decimal, '.');
  } else if (lastComma !== -1 || lastDot !== -1) {
    const sep = lastComma !== -1 ? ',' : '.';
    const parts = digits.split(sep);
    const tail = parts[parts.length - 1];
    // A single separator followed by 1-2 digits is a decimal separator ("14,99", "5.5");
    // followed by exactly 3 digits it groups thousands ("1.349", "2,499")
    if (parts.length === 2 && tail.length !== 3) {
      digits = parts.join('.');
    } else {
      digits = parts.join('');
    }
  }

  const price = Math.round(parseFloat(digits) * 100) / 100;
  if (!isFinite(price) || price <= 0) return null;
  return { price, currency: detectCurrency(clean, fallbackCurrency) };
}

// Normalise a schema.org availability value ("https://schema.org/InStock", "InStock", "in stock")
export function parseAvailability(value: unknown): 'in_stock' | 'out_of_stock' | 'unknown' {
  if (typeof value !== 'string') return 'unknown';
  const v = value.toLowerCase();
  if (/outofstock|soldout|discontinued|out of stock|sem stock|esgotado|indispon/.test(v)) return 'out_of_stock';
  if (/instock|limitedavailability|onlineonly|preorder|in stock|em stock|dispon/.test(v)) return 'in_stock';
  return 'unknown';
}
