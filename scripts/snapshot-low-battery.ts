/**
 * Rebuilds data/low-battery/products.json from a public phone store (Tiendanube): the pesos store and its dollar twin
 * (`/us/`), joined by product id. The server never fetches anything at request time; run this by hand to refresh:
 *
 *   npm run snapshot:low-battery
 */
import { writeFileSync } from 'node:fs';

const SITE = 'https://liberadosya.com';
const CATEGORIES = ['xiaomi', 'samsung', 'motorola', 'iphonenuevos', 'iphoneusados', 'celulares', 'infinix', 'huawei', 'google', 'oppo', 'nokia', 'realme'];
/** Accessories that the phone categories also list. */
const NOT_PHONES = /^(auricular|google chromecast)/i;
const MAX_PAGES = 40;
const OUT = new URL('../data/low-battery/products.json', import.meta.url);

interface Variant {
  option: string | null;
  price: number | null;
  cash: string | null;
  available: boolean;
}
interface Listed {
  id: string;
  slug: string;
  name: string;
  variants: Variant[];
}

const decode = (text: string): string =>
  text.replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

function listed(page: string): Listed[] {
  const out: Listed[] = [];
  for (const block of page.split('item-container m-bottom-half').slice(1)) {
    const id = /data-product-id="(\d+)"/.exec(block)?.[1];
    const variants = /data-variants="([^"]*)"/.exec(block)?.[1];
    const href = /href="([^"]*\/productos\/[^"?]*)/.exec(block)?.[1];
    const name = /aria-label="([^"]*)"\s+data-store="product-item-name/.exec(block)?.[1];
    if (id === undefined || variants === undefined || href === undefined || name === undefined) {
      continue;
    }
    const parsed = JSON.parse(decode(variants)) as Record<string, any>[];
    out.push({
      id,
      slug: href.replace(/\/$/, '').split('/').pop() as string,
      name: decode(name).trim(),
      variants: parsed.map((v) => ({
        option: v.option0 ?? null,
        price: v.price_number ?? null,
        cash: v.price_with_payment_discount_short ?? null,
        available: v.available === true,
      })),
    });
  }
  return out;
}

async function crawl(prefix: string): Promise<Map<string, { categories: Set<string>; item: Listed }>> {
  const found = new Map<string, { categories: Set<string>; item: Listed }>();
  for (const category of CATEGORIES) {
    for (let page = 1; page <= MAX_PAGES; page++) {
      const response = await fetch(`${SITE}/${prefix}${category}/${page === 1 ? '' : `?page=${page}`}`, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      if (!response.ok) {
        throw new Error(`${response.url} answered ${response.status}`);
      }
      const items = listed(await response.text());
      if (items.length === 0) {
        break;
      }
      for (const item of items) {
        const entry = found.get(item.id) ?? { categories: new Set<string>(), item };
        entry.categories.add(category);
        found.set(item.id, entry);
      }
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }
  return found;
}

/** "$1.252.357,68" (pesos) or "$253.64 USD" (dollars) to a number. */
function money(text: string | null, currency: 'ARS' | 'USD'): number | null {
  if (text === null) {
    return null;
  }
  const digits = text.replace(/[^\d,.]/g, '');
  return Number(currency === 'ARS' ? digits.replace(/\./g, '').replace(',', '.') : digits);
}

const lowest = (values: (number | null)[]): number | null => {
  const present = values.filter((v): v is number => v !== null);
  return present.length === 0 ? null : Math.min(...present);
};

const ars = await crawl('');
const usd = await crawl('us/');

const products = [...ars.entries()]
  .filter(([, { item }]) => !NOT_PHONES.test(item.name))
  .map(([id, { categories, item }]) => {
    const dollars = usd.get(id)?.item;
    const used = /\(usado\)/i.test(item.name);
    const refurbished = /\(cpo\)/i.test(item.name);
    const brandWord = item.name.split(/\s+/)[0] as string;
    const storage = /(\d+)\s?(gb|tb)/i.exec(item.name);
    const ram = /(\d+)\s?ram/i.exec(item.name);
    const options = [...new Set(item.variants.map((v) => v.option).filter((o): o is string => o !== null))];
    const battery = used ? /(\d+)\s?%/.exec(options[0] ?? '')?.[1] : undefined;
    return {
      id,
      slug: item.slug,
      name: item.name,
      brand: brandWord,
      condition: used ? 'used' : refurbished ? 'refurbished' : 'new',
      storage_gb: storage === null ? null : Number(storage[1]) * (storage[2]?.toLowerCase() === 'tb' ? 1024 : 1),
      ram_gb: ram === null ? null : Number(ram[1]),
      colors: [...new Set(options.map((o) => o.replace(/\s*\d+\s?%$/, '').trim()))],
      battery_health_pct: battery === undefined ? null : Number(battery),
      price_ars: lowest(item.variants.map((v) => v.price)),
      cash_price_ars: lowest(item.variants.map((v) => money(v.cash, 'ARS'))),
      price_usd: lowest((dollars?.variants ?? []).map((v) => v.price)),
      cash_price_usd: lowest((dollars?.variants ?? []).map((v) => money(v.cash, 'USD'))),
      in_stock: item.variants.some((v) => v.available),
      source_url: `${SITE}/productos/${item.slug}/`,
    };
  })
  .sort((a, b) => a.name.localeCompare(b.name));

const round = (n: number | null, digits: number): number | null => (n === null ? null : Number(n.toFixed(digits)));
const rows = products.map((p) => ({
  ...p,
  price_ars: round(p.price_ars, 0),
  cash_price_ars: round(p.cash_price_ars, 0),
  price_usd: round(p.price_usd, 2),
  cash_price_usd: round(p.cash_price_usd, 2),
}));

writeFileSync(OUT, `${JSON.stringify({ source: SITE, read_at: new Date().toISOString().slice(0, 10), products: rows }, null, 1)}\n`);
console.log(`${rows.length} products, ${rows.filter((p) => p.price_ars !== null).length} with a price`);
