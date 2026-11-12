import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, test } from 'vitest';
import { createLowBatteryTenant } from './index.js';
import { loadSnapshot } from './phones.js';

interface ToolResult {
  isError?: boolean;
  content: { type: string; text: string }[];
  structuredContent?: Record<string, any>;
}

async function connect(): Promise<Client> {
  const server = createLowBatteryTenant().createServer();
  const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '1' });
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
  return client;
}
const call = async (client: Client, name: string, args: Record<string, unknown> = {}) =>
  (await client.callTool({ name, arguments: args })) as ToolResult;

const phones = loadSnapshot().products;

describe('Low Battery dataset', () => {
  test('has hundreds of phones, unique ids and slugs, and mostly priced', () => {
    expect(phones.length).toBeGreaterThan(300);
    expect(new Set(phones.map((p) => p.id)).size).toBe(phones.length);
    expect(new Set(phones.map((p) => p.slug)).size).toBe(phones.length);
    expect(phones.filter((p) => p.price_ars !== null).length).toBeGreaterThan(100);
  });

  test('a phone is priced in both currencies or in neither, and cash never exceeds list', () => {
    for (const p of phones) {
      expect(p.price_ars === null, p.slug).toBe(p.price_usd === null);
      if (p.price_ars !== null && p.cash_price_ars !== null) {
        expect(p.cash_price_ars, p.slug).toBeLessThanOrEqual(p.price_ars);
      }
      if (p.price_usd !== null && p.cash_price_usd !== null) {
        expect(p.cash_price_usd, p.slug).toBeLessThanOrEqual(p.price_usd);
      }
    }
  });

  test('the implied exchange rate is one number within a few percent', () => {
    const rates = phones.filter((p) => p.price_ars !== null && p.price_usd !== null).map((p) => (p.price_ars as number) / (p.price_usd as number));
    expect(Math.max(...rates) / Math.min(...rates)).toBeLessThan(1.02);
  });

  test('only used phones carry a battery health', () => {
    for (const p of phones) {
      expect(p.battery_health_pct === null || p.condition === 'used', p.slug).toBe(true);
    }
  });
});

describe('Low Battery tenant', () => {
  test('offers exactly five tools', async () => {
    const { tools } = await (await connect()).listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(['compare_products', 'get_business_info', 'get_product', 'list_categories', 'search_products']);
  });

  test('business info follows the split weekday hours', async () => {
    const client = await connect();
    const open = async (at: string) => (await call(client, 'get_business_info', { at })).structuredContent?.open_now;
    expect(await open('2026-11-09T10:00:00')).toBe(true); // Monday morning
    expect(await open('2026-11-09T14:00:00')).toBe(false); // Monday midday break
    expect(await open('2026-11-09T17:00:00')).toBe(true); // Monday evening
    expect(await open('2026-11-14T10:00:00')).toBe(true); // Saturday morning
    expect(await open('2026-11-14T17:00:00')).toBe(false); // Saturday afternoon
    expect(await open('2026-11-15T10:00:00')).toBe(false); // Sunday
  });

  test('search by brand and condition returns only that', async () => {
    const result = await call(await connect(), 'search_products', { brand: 'apple', condition: 'used', limit: 20 });
    expect(result.structuredContent?.total_matches).toBeGreaterThan(5);
    for (const p of result.structuredContent?.products) {
      expect(p.brand).toBe('Apple');
      expect(p.condition).toBe('used');
    }
  });

  test('results are cheapest first and unpriced phones come last', async () => {
    const result = await call(await connect(), 'search_products', { brand: 'Apple', limit: 20 });
    const prices: (number | null)[] = result.structuredContent?.products.map((p: any) => p.price_ars);
    const firstNull = prices.indexOf(null);
    const priced = firstNull === -1 ? prices : prices.slice(0, firstNull);
    expect(priced).toEqual([...priced].sort((a, b) => (a as number) - (b as number)));
    expect(prices.slice(firstNull === -1 ? prices.length : firstNull).every((p) => p === null)).toBe(true);
  });

  test('the currency decides the unit of the price filter', async () => {
    const client = await connect();
    // 500 is a plausible dollar amount and a ridiculous peso one: the same filter must answer differently.
    const usd = await call(client, 'search_products', { max_price: 500, currency: 'USD', limit: 20 });
    const ars = await call(client, 'search_products', { max_price: 500, limit: 20 });
    expect(usd.structuredContent?.total_matches).toBeGreaterThan(0);
    expect(ars.structuredContent?.total_matches).toBe(0);
    for (const p of usd.structuredContent?.products) {
      expect(p.price_usd).toBeLessThanOrEqual(500);
    }
  });

  test('a price filter excludes phones with no price', async () => {
    const result = await call(await connect(), 'search_products', { min_price: 0, limit: 20 });
    for (const p of result.structuredContent?.products) {
      expect(p.price_ars).not.toBeNull();
    }
  });

  test('storage and ram are exact filters', async () => {
    const result = await call(await connect(), 'search_products', { storage_gb: 256, ram_gb: 8, limit: 20 });
    expect(result.structuredContent?.total_matches).toBeGreaterThan(0);
    for (const p of result.structuredContent?.products) {
      expect(p.storage_gb).toBe(256);
      expect(p.ram_gb).toBe(8);
    }
  });

  test('a search with no match is a normal answer', async () => {
    const result = await call(await connect(), 'search_products', { query: 'zzzz-no-existe' });
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent?.total_matches).toBe(0);
  });

  test('get_product answers by slug and by id, and an unknown key suggests slugs', async () => {
    const client = await connect();
    const priced = phones.find((p) => p.price_ars !== null && p.price_usd !== null)!;
    const bySlug = await call(client, 'get_product', { id: priced.slug });
    const byId = await call(client, 'get_product', { id: priced.id });
    expect(bySlug.structuredContent).toMatchObject({ id: priced.id, price_ars: priced.price_ars, price_usd: priced.price_usd });
    expect(byId.structuredContent?.slug).toBe(priced.slug);
    const missing = await call(client, 'get_product', { id: `${priced.slug.slice(0, 12)}-zzz` });
    expect(missing.isError).toBe(true);
  });

  test('an unpriced phone is reported as price on request, never a number', async () => {
    const unpriced = phones.find((p) => p.price_ars === null)!;
    const result = await call(await connect(), 'get_product', { id: unpriced.slug });
    expect(result.structuredContent?.price_ars).toBeNull();
    expect(result.structuredContent?.price_usd).toBeNull();
    expect(result.content[0]?.text).toContain('price on request');
  });

  test('list_categories counts every phone once', async () => {
    const result = await call(await connect(), 'list_categories');
    const total = result.structuredContent?.categories.reduce((sum: number, c: any) => sum + c.count, 0);
    expect(total).toBe(phones.length);
  });

  test('compare_products names the cheapest in the chosen currency and refuses unknown phones', async () => {
    const client = await connect();
    const [a, b] = phones.filter((p) => p.price_usd !== null).slice(0, 40).sort((x, y) => (x.price_usd as number) - (y.price_usd as number)).filter((_, i, all) => i === 0 || i === all.length - 1) as [typeof phones[number], typeof phones[number]];
    const result = await call(client, 'compare_products', { ids: [b.slug, a.slug], currency: 'USD' });
    expect(result.structuredContent?.cheapest_id).toBe(a.id);
    const bad = await call(client, 'compare_products', { ids: [a.slug, 'no-existe'] });
    expect(bad.isError).toBe(true);
  });
});
