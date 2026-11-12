import { z } from 'zod';
import { dataFile, loadJson } from '../../data.js';
import { type Accessory, AccessorySchema, parseAccessories } from './accessories.js';
import { type Reading, createCachedSource } from './cache.js';
import { type FaqEntry, FaqEntrySchema, parseFaqPage } from './faq.js';
import { IphoneSchema, type PriceList, parsePriceList } from './price-list.js';

export const SITE = 'https://mobikiphones.com.ar';
export const PRICE_LIST_URL = `${SITE}/lista-de-precios/`;
export const ACCESSORIES_URL = `${SITE}/wp-json/wc/store/v1/products?category=accesorios&per_page=100`;
export const FAQ_URL = `${SITE}/preguntas-frecuentes/`;
export const SHIPPING_POLICY_URL = `${SITE}/politicas-de-envio/`;
export const DEFAULT_TTL_SECONDS = 60;
const TIMEOUT_MS = 8000;
const USER_AGENT = 'erp-mock-mcp/0.1';

/**
 * The copy of the catalog shipped with the repository, served only until the first successful read of the store.
 * It carries no trade-in table: those values are internal to the store, so a quote needs a live read.
 */
const SnapshotSchema = z.object({
  read_at: z.string(),
  iphones: z.array(IphoneSchema).min(1),
  accessories: z.array(AccessorySchema).min(1),
  faq: z.array(FaqEntrySchema).min(1),
});
export type Snapshot = z.infer<typeof SnapshotSchema>;
export const loadSnapshot = (): Snapshot => loadJson(SnapshotSchema, dataFile('mobik', 'snapshot.json'));

export type Fetcher = (url: string, init: { headers: Record<string, string>; signal: AbortSignal }) => Promise<Response>;

async function get(fetcher: Fetcher, url: string): Promise<Response> {
  const response = await fetcher(url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!response.ok) {
    throw new Error(`${url} answered ${response.status}`);
  }
  return response;
}

export const fetchPriceList = async (fetcher: Fetcher): Promise<PriceList> => parsePriceList(await (await get(fetcher, PRICE_LIST_URL)).text());
export const fetchAccessories = async (fetcher: Fetcher): Promise<Accessory[]> => parseAccessories(await (await get(fetcher, ACCESSORIES_URL)).json());

/** Both pages are read together: one that fails or loses its shape fails the whole read, and the last good copy is kept. */
export async function fetchFaq(fetcher: Fetcher): Promise<FaqEntry[]> {
  const [faq, shipping] = await Promise.all([get(fetcher, FAQ_URL), get(fetcher, SHIPPING_POLICY_URL)]);
  return [...parseFaqPage(await faq.text(), 'faq', FAQ_URL), ...parseFaqPage(await shipping.text(), 'shipping_policy', SHIPPING_POLICY_URL)];
}

export interface Sources {
  priceList: () => Promise<Reading<PriceList>>;
  accessories: () => Promise<Reading<Accessory[]>>;
  faq: () => Promise<Reading<FaqEntry[]>>;
}

export interface SourceOptions {
  ttlSeconds?: number;
  fetcher?: Fetcher;
  now?: () => number;
}

export function createSources(options: SourceOptions = {}): Sources {
  const snapshot = loadSnapshot();
  const fetcher: Fetcher = options.fetcher ?? ((url, init) => fetch(url, init));
  const shared = { ttlMs: (options.ttlSeconds ?? DEFAULT_TTL_SECONDS) * 1000, ...(options.now !== undefined && { now: options.now }) };
  return {
    priceList: createCachedSource<PriceList>({
      ...shared,
      load: () => fetchPriceList(fetcher),
      fallback: { value: { iphones: snapshot.iphones, tradeIn: null }, read_at: snapshot.read_at },
    }),
    accessories: createCachedSource<Accessory[]>({
      ...shared,
      load: () => fetchAccessories(fetcher),
      fallback: { value: snapshot.accessories, read_at: snapshot.read_at },
    }),
    faq: createCachedSource<FaqEntry[]>({
      ...shared,
      load: () => fetchFaq(fetcher),
      fallback: { value: snapshot.faq, read_at: snapshot.read_at },
    }),
  };
}
