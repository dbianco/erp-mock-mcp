import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, test } from 'vitest';
import { createGuemesTenant } from './index.js';
import { loadTyres } from './tyres.js';

interface ToolResult {
  isError?: boolean;
  content: { type: string; text: string }[];
  structuredContent?: Record<string, any>;
}

async function connect(): Promise<Client> {
  const server = createGuemesTenant().createServer();
  const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '1' });
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
  return client;
}
const call = async (client: Client, name: string, args: Record<string, unknown> = {}) =>
  (await client.callTool({ name, arguments: args })) as ToolResult;

describe('Güemes tenant', () => {
  test('offers exactly six tools', async () => {
    const { tools } = await (await connect()).listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      'get_business_info',
      'get_maintenance_tips',
      'get_product',
      'list_categories',
      'list_services',
      'search_products',
    ]);
  });

  test('business info has the real contact data and weekday-only hours', async () => {
    const client = await connect();
    const info = (await call(client, 'get_business_info')).structuredContent;
    expect(info).toMatchObject({ address: 'Julio A. Roca 987, X5000CQG Córdoba', phone: '0351 460-3165' });
    expect(info?.links.facebook).toContain('facebook.com');
    const open = async (at: string) => (await call(client, 'get_business_info', { at })).structuredContent?.open_now;
    expect(await open('2026-10-23T09:00:00')).toBe(true); // Friday
    expect(await open('2026-10-23T18:00:00')).toBe(false); // Friday closing minute
    expect(await open('2026-10-24T09:00:00')).toBe(false); // Saturday
    expect(await open('2026-10-25T09:00:00')).toBe(false); // Sunday
  });

  test('search_products by size returns the tyres of that size with prices', async () => {
    const result = await call(await connect(), 'search_products', { size: '205/55R16', limit: 20 });
    expect(result.structuredContent?.total_matches).toBeGreaterThanOrEqual(2);
    for (const tyre of result.structuredContent?.products) {
      expect(tyre.size).toBe('205/55 R16');
      expect(tyre.cash_price).toBeGreaterThan(0);
    }
  });

  test('search_products with no match is a normal answer', async () => {
    const result = await call(await connect(), 'search_products', { query: 'zzzz-no-existe' });
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent?.total_matches).toBe(0);
    expect(result.content[0]?.text).toContain('0 match(es)');
  });

  test('an unknown category is an isError result listing the valid ones', async () => {
    const result = await call(await connect(), 'search_products', { category: 'tractor' });
    expect(result.isError).toBe(true);
    for (const valid of ['auto', 'camioneta', 'moto']) {
      expect(result.content[0]?.text).toContain(valid);
    }
  });

  test('get_product returns the record, and an unknown sku suggests near ids', async () => {
    const client = await connect();
    const first = loadTyres()[0]!;
    const found = await call(client, 'get_product', { sku: first.sku });
    expect(found.structuredContent).toMatchObject({ id: first.id, size: first.size, currency: 'ARS' });
    const missing = await call(client, 'get_product', { sku: `${first.sku.slice(0, 4)}9999` });
    expect(missing.isError).toBe(true);
    expect(missing.content[0]?.text).toContain(first.id);
  });

  test('list_categories counts add up to the catalog size', async () => {
    const { categories } = (await call(await connect(), 'list_categories')).structuredContent as {
      categories: { category: string; count: number }[];
    };
    expect(categories.map((c) => c.category)).toEqual(['auto', 'camioneta', 'moto']);
    expect(categories.reduce((sum, c) => sum + c.count, 0)).toBe(15);
  });
});

const plain = (text: string): string => text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

describe('Güemes services and tips', () => {
  test('list_services includes balancing, shock absorbers and rotation, with positive from-prices', async () => {
    const { services } = (await call(await connect(), 'list_services')).structuredContent as {
      services: { name: string; from_price: number; duration_minutes: number; includes: string[] }[];
    };
    const names = services.map((s) => plain(s.name)).join(' | ');
    for (const wanted of ['balanceo', 'amortiguadores', 'rotacion']) {
      expect(names).toContain(wanted);
    }
    for (const service of services) {
      expect(Number.isInteger(service.from_price) && service.from_price > 0).toBe(true);
      expect(service.duration_minutes).toBeGreaterThan(0);
    }
  });

  test('tips include rotation every 10.000 km and a pressure check', async () => {
    const { tips } = (await call(await connect(), 'get_maintenance_tips')).structuredContent as {
      tips: { topic: string; text: string }[];
    };
    expect(tips.some((t) => t.text.includes('10.000 km'))).toBe(true);
    expect(tips.some((t) => plain(t.topic).includes('presion'))).toBe(true);
  });

  test("topic 'presion' without the accent finds the pressure tips", async () => {
    const { tips } = (await call(await connect(), 'get_maintenance_tips', { topic: 'presion' })).structuredContent as {
      tips: { topic: string }[];
    };
    expect(tips.length).toBeGreaterThanOrEqual(1);
    expect(tips.every((t) => plain(t.topic) === 'presion')).toBe(true);
  });

  test('an unknown topic is an isError result listing the valid topics', async () => {
    const result = await call(await connect(), 'get_maintenance_tips', { topic: 'cocina' });
    expect(result.isError).toBe(true);
    expect(plain(result.content[0]?.text ?? '')).toContain('presion');
  });
});
