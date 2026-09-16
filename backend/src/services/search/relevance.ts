// Words that mark a listing as an accessory for the product rather than the product itself
// ("Capa iPhone 15", "Vertical Stand for PS5 Slim"). Deliberately excludes words like
// "comando"/"controller" that also appear in bundles ("PS5 + 2 Comandos").
const ACCESSORY_WORDS = new Set([
  'capa', 'capas', 'pelicula', 'peliculas', 'protetor', 'protetora', 'protector', 'protectora', 'protective',
  'vidro', 'cabo', 'carregador', 'suporte', 'adaptador', 'bolsa', 'funda', 'fundas', 'cargador', 'soporte',
  'case', 'cases', 'cover', 'covers', 'charger', 'chargers', 'cable', 'cables', 'adapter', 'adapters',
  'holder', 'holders', 'strap', 'straps', 'bracelete', 'correia', 'stand', 'stands', 'mount', 'mounts',
  'faceplate', 'faceplates', 'skin', 'skins', 'sticker', 'stickers', 'autocolante', 'vinilo', 'socle',
  'dock', 'docks', 'compatible', 'compatibles', 'compativel', 'compativeis',
]);

// Words that turn a model into a different one when they directly follow it
// ("Galaxy S24 FE", "iPhone 15 Pro"); "+" is tokenized as "plus"
const VARIANT_WORDS = new Set(['pro', 'max', 'plus', 'ultra', 'fe', 'mini', 'lite', 'se', 'neo', 'edge', 'air']);

function looksLikeOtherVariant(queryTokens: string[], titleTokens: string[]): boolean {
  const querySet = new Set(queryTokens);
  return titleTokens.some(
    (token, i) => i > 0 && querySet.has(titleTokens[i - 1]) && VARIANT_WORDS.has(token) && !querySet.has(token)
  );
}

// "... for iPhone 15", "... para PlayStation 5", "compatible con ..." introduce the product an
// accessory is meant for
const TARGET_CONNECTORS = new Set(['for', 'para', 'with', 'com', 'con', 'compatible', 'compativel']);

function looksLikeAccessory(queryTokens: string[], titleTokens: string[]): boolean {
  const querySet = new Set(queryTokens);
  if (titleTokens.some((token) => ACCESSORY_WORDS.has(token) && !querySet.has(token))) return true;

  const first = queryTokens[0];
  return titleTokens.some((token, i) => i > 0 && token === first && TARGET_CONNECTORS.has(titleTokens[i - 1]) && !querySet.has(titleTokens[i - 1]));
}

// Refurbished / used listings are usually far cheaper and would win every price comparison
const REFURBISHED_PATTERN =
  /\b(recondicionad[oa]s?|reacondicionad[oa]s?|refurbished|renewed|remanufactured|usad[oa]s?|seminov[oa]s?|segunda mao|second hand|pre owned|open box|reembalad[oa]s?|como novo|como nuevo|outlet|grade [abc]|grau [abc])\b/;

export function detectCondition(title: string): 'new' | 'refurbished' {
  return REFURBISHED_PATTERN.test(normalize(title)) ? 'refurbished' : 'new';
}

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    // "S24+" is a model, "Slim + 2 Comandos" a bundle
    .replace(/([a-z0-9])\+/g, '$1 plus ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function tokenize(text: string): string[] {
  return normalize(text).split(' ').filter(Boolean);
}

/**
 * Score how well a result title matches the query, from 0 to 1.
 * Store search engines are generous (a query for "iphone 15" returns iPhone 17s and cases),
 * so results are ranked by the share of query words found in the title. Numbers weigh
 * double because they usually carry the model or capacity.
 */
export function scoreRelevance(queryTokens: string[], title: string): number {
  if (queryTokens.length === 0) return 1;

  const titleTokens = tokenize(title);
  const titleSet = new Set(titleTokens);
  // "128gb" in the query should match "128 GB" in the title and vice versa
  const compactTitle = titleTokens.join('');

  let total = 0;
  let matched = 0;
  for (const token of queryTokens) {
    const weight = /\d/.test(token) ? 2 : 1;
    total += weight;
    if (titleSet.has(token) || (token.length >= 3 && compactTitle.includes(token))) {
      matched += weight;
    }
  }

  let score = matched / total;
  if (looksLikeAccessory(queryTokens, titleTokens)) {
    score *= 0.5;
  } else if (looksLikeOtherVariant(queryTokens, titleTokens)) {
    score *= 0.7;
  }
  return Math.round(score * 100) / 100;
}
