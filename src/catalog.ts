import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { CATEGORIES, type Category } from './categories.js';
import { normalise, tokenise } from './text.js';

const VariantSchema = z.object({ sku: z.string(), label: z.string().nullable() });

export const ProductSchema = z.object({
  id: z.string(),
  sku: z.string().nullable(),
  name: z.string(),
  category: z.enum(CATEGORIES),
  list_price: z.number().int().nullable(),
  cash_price: z.number().int().nullable(),
  installment_24: z.number().int().nullable(),
  currency: z.literal('ARS'),
  variants: z.array(VariantSchema),
  availability_note: z.string().nullable(),
  image_file: z.string().nullable(),
});

export type Product = z.infer<typeof ProductSchema>;
export type Catalog = readonly Product[];

export const DEFAULT_LIMIT = 5;

export interface SearchOptions {
  query?: string;
  category?: Category;
  minPrice?: number;
  maxPrice?: number;
  limit?: number;
}

export interface SearchResult {
  totalMatches: number;
  products: Product[];
}

export function loadCatalog(file: URL = new URL('../data/catalog.json', import.meta.url)): Catalog {
  return z.array(ProductSchema).parse(JSON.parse(readFileSync(file, 'utf8')));
}

export function resolveCategory(value: string): Category | undefined {
  const wanted = normalise(value.trim());
  return CATEGORIES.find((category) => normalise(category) === wanted);
}

/** The text a query is matched against: the name and any variant labels, never the category. */
function haystack(product: Product): string {
  return normalise(`${product.name} ${product.variants.map((v) => v.label ?? '').join(' ')}`);
}

function matchesToken(text: string, token: string): boolean {
  if (text.includes(token)) {
    return true;
  }
  // "bicicletas" must find "BICICLETA" and "tocadores" must find "TOCADOR": a trailing plural
  // "s" or "es" is also tried without it.
  if (token.length > 3 && token.endsWith('s') && text.includes(token.slice(0, -1))) {
    return true;
  }
  return token.length > 4 && token.endsWith('es') && text.includes(token.slice(0, -2));
}

function withinPrice(product: Product, minPrice?: number, maxPrice?: number): boolean {
  if (minPrice === undefined && maxPrice === undefined) {
    return true;
  }
  const price = product.cash_price;
  return price !== null && (minPrice === undefined || price >= minPrice) && (maxPrice === undefined || price <= maxPrice);
}

/** Cash price ascending, priceless last, ties by id. Deterministic: no relevance ranking. */
function byCashPrice(a: Product, b: Product): number {
  if (a.cash_price === b.cash_price) {
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  }
  if (a.cash_price === null) {
    return 1;
  }
  if (b.cash_price === null) {
    return -1;
  }
  return a.cash_price - b.cash_price;
}

export function searchProducts(catalog: Catalog, options: SearchOptions): SearchResult {
  const tokens = tokenise(options.query ?? '');
  const matched = catalog
    .filter((product) => options.category === undefined || product.category === options.category)
    .filter((product) => {
      const text = haystack(product);
      return tokens.every((token) => matchesToken(text, token));
    })
    .filter((product) => withinPrice(product, options.minPrice, options.maxPrice))
    .sort(byCashPrice);
  return { totalMatches: matched.length, products: matched.slice(0, options.limit ?? DEFAULT_LIMIT) };
}

export function findProduct(catalog: Catalog, key: string): Product | undefined {
  const wanted = key.trim().toUpperCase();
  return catalog.find(
    (product) =>
      product.id.toUpperCase() === wanted ||
      product.sku?.toUpperCase() === wanted ||
      product.variants.some((variant) => variant.sku.toUpperCase() === wanted),
  );
}

export function didYouMean(catalog: Catalog, key: string): string[] {
  const prefix = key.trim().toUpperCase().slice(0, 5);
  return catalog
    .map((product) => product.id)
    .filter((id) => id.toUpperCase().startsWith(prefix))
    .sort()
    .slice(0, 3);
}

export function discountPercent(product: Product): number | null {
  if (product.list_price === null || product.cash_price === null || product.list_price <= 0) {
    return null;
  }
  return Math.max(0, Math.round((100 * (product.list_price - product.cash_price)) / product.list_price));
}
