import { z } from 'zod';
import { dataFile, loadJson } from '../../data.js';
import { normalise, tokenise } from '../../text.js';

export const CONDITIONS = ['new', 'used', 'refurbished'] as const;
export type Condition = (typeof CONDITIONS)[number];
export const CURRENCIES = ['ARS', 'USD'] as const;
export type Currency = (typeof CURRENCIES)[number];

const price = z.number().positive().nullable();

export const PhoneSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  brand: z.string(),
  condition: z.enum(CONDITIONS),
  storage_gb: z.number().int().positive().nullable(),
  ram_gb: z.number().int().positive().nullable(),
  colors: z.array(z.string()),
  battery_health_pct: z.number().int().min(0).max(100).nullable(),
  price_ars: price,
  cash_price_ars: price,
  price_usd: price,
  cash_price_usd: price,
  in_stock: z.boolean(),
  source_url: z.string(),
});
export type Phone = z.infer<typeof PhoneSchema>;

const SnapshotSchema = z.object({ source: z.string(), read_at: z.string(), products: z.array(PhoneSchema).min(1) });
export type Snapshot = z.infer<typeof SnapshotSchema>;

export const DEFAULT_LIMIT = 5;

export const loadSnapshot = (): Snapshot => {
  const snapshot = loadJson(SnapshotSchema, dataFile('low-battery', 'products.json'));
  const ids = new Set(snapshot.products.map((p) => p.id));
  if (ids.size !== snapshot.products.length) {
    throw new Error('Invalid data file products.json: duplicate product ids');
  }
  return snapshot;
};

/** The list price of a phone in a currency, or null when the store publishes none ("price on request"). */
export const listPrice = (phone: Phone, currency: Currency): number | null => (currency === 'ARS' ? phone.price_ars : phone.price_usd);
export const cashPrice = (phone: Phone, currency: Currency): number | null =>
  currency === 'ARS' ? phone.cash_price_ars : phone.cash_price_usd;

export interface PhoneSearch {
  query?: string;
  brand?: string;
  condition?: Condition;
  storageGb?: number;
  ramGb?: number;
  minPrice?: number;
  maxPrice?: number;
  currency?: Currency;
  inStockOnly?: boolean;
  limit?: number;
}

/** List price ascending in the chosen currency, phones with no price last, ties by name then id: deterministic. */
const byPrice = (currency: Currency) => (a: Phone, b: Phone) => {
  const pa = listPrice(a, currency);
  const pb = listPrice(b, currency);
  if (pa === null || pb === null) {
    return pa === pb ? a.name.localeCompare(b.name) || a.id.localeCompare(b.id) : pa === null ? 1 : -1;
  }
  return pa - pb || a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
};

export function searchPhones(phones: readonly Phone[], o: PhoneSearch): { totalMatches: number; phones: Phone[] } {
  const currency = o.currency ?? 'ARS';
  const tokens = tokenise(o.query ?? '');
  const brand = o.brand === undefined ? undefined : normalise(o.brand.trim());
  const priced = o.minPrice !== undefined || o.maxPrice !== undefined;
  const matched = phones
    .filter((p) => brand === undefined || normalise(p.brand) === brand)
    .filter((p) => o.condition === undefined || p.condition === o.condition)
    .filter((p) => o.storageGb === undefined || p.storage_gb === o.storageGb)
    .filter((p) => o.ramGb === undefined || p.ram_gb === o.ramGb)
    .filter((p) => o.inStockOnly !== true || p.in_stock)
    .filter((p) => {
      if (!priced) {
        return true;
      }
      const value = listPrice(p, currency);
      return value !== null && (o.minPrice === undefined || value >= o.minPrice) && (o.maxPrice === undefined || value <= o.maxPrice);
    })
    .filter((p) => {
      const text = normalise(`${p.name} ${p.brand}`);
      return tokens.every((token) => text.includes(token));
    })
    .sort(byPrice(currency));
  return { totalMatches: matched.length, phones: matched.slice(0, o.limit ?? DEFAULT_LIMIT) };
}

export function findPhone(phones: readonly Phone[], key: string): Phone | undefined {
  const wanted = normalise(key.trim());
  return phones.find((p) => p.id === wanted || normalise(p.slug) === wanted);
}

/** Up to three product slugs sharing the first words of a key that matched nothing. */
export function didYouMean(phones: readonly Phone[], key: string): string[] {
  const prefix = normalise(key.trim()).slice(0, 8);
  return phones
    .filter((p) => normalise(p.slug).startsWith(prefix))
    .map((p) => p.slug)
    .slice(0, 3);
}

export function brandCounts(phones: readonly Phone[]): { brand: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const phone of phones) {
    counts.set(phone.brand, (counts.get(phone.brand) ?? 0) + 1);
  }
  return [...counts.entries()].map(([brand, count]) => ({ brand, count })).sort((a, b) => b.count - a.count || a.brand.localeCompare(b.brand));
}
