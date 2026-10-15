import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, test } from 'vitest';
import { type Catalog, loadCatalog } from './catalog.js';
import { createCatalogServer, imageCaption, imageUrl } from './tools.js';

const catalog = loadCatalog();
const BASE = 'https://img.example/m';

async function connect(source: Catalog = catalog): Promise<Client> {
  const server = createCatalogServer(source, { imageBaseUrl: BASE });
  const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '1' });
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
  return client;
}

interface ToolResult {
  isError?: boolean;
  content: { type: string; text: string }[];
  structuredContent?: Record<string, any>;
}

async function call(client: Client, name: string, args: Record<string, unknown>): Promise<ToolResult> {
  return (await client.callTool({ name, arguments: args })) as ToolResult;
}

describe('tool listing', () => {
  test('offers exactly the three read-only tools, each with a description', async () => {
    const { tools } = await (await connect()).listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(['get_product', 'list_categories', 'search_products']);
    for (const tool of tools) {
      expect((tool.description ?? '').length).toBeGreaterThan(40);
    }
  });
});

describe('search_products', () => {
  test('returns structured results, cheapest first, with the total', async () => {
    const result = await call(await connect(), 'search_products', { query: 'bicicleta', max_price: 300000 });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent?.total_matches).toBe(2);
    expect(result.structuredContent?.products.map((p: { id: string }) => p.id)).toEqual(['23541108', '23541510']);
    expect(result.content[0]?.text).toContain('2 match');
  });

  test('an unknown category is an error that lists the valid ones', async () => {
    const result = await call(await connect(), 'search_products', { category: 'muebles' });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('Valid categories');
    expect(result.content[0]?.text).toContain('sillones y sofás');
  });

  test('a category given without accents still resolves', async () => {
    const result = await call(await connect(), 'search_products', { category: 'jardin' });
    expect(result.structuredContent?.total_matches).toBe(2);
  });

  test('an out-of-range limit is reported as an error result, not thrown', async () => {
    const result = await call(await connect(), 'search_products', { limit: 99 });
    expect(result.isError).toBe(true);
  });
});

describe('get_product', () => {
  test('answers a variant SKU with the whole product and its derived discount', async () => {
    const bike = await call(await connect(), 'get_product', { sku: '23541120' });
    expect(bike.structuredContent).toMatchObject({ id: '23541108', currency: 'ARS' });
    expect(bike.structuredContent?.variants).toHaveLength(3);

    const quint = await call(await connect(), 'get_product', { sku: '23541112' });
    expect(quint.structuredContent?.discount_percent).toBe(17);
  });

  test('a priceless product says "price on request" and invents nothing', async () => {
    const robot = await call(await connect(), 'get_product', { sku: '51551032' });
    expect(robot.structuredContent).toMatchObject({
      cash_price: null,
      installment_24: null,
      discount_percent: null,
      availability_note: 'price on request',
    });
  });

  test('an unknown SKU is an error with did-you-mean candidates', async () => {
    const result = await call(await connect(), 'get_product', { sku: '23541999' });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('23541108');
  });

  test('the caption is a Spanish line with the cash price and the instalment', async () => {
    const sofa = await call(await connect(), 'get_product', { sku: '14798061' });
    expect(sofa.structuredContent?.image_caption).toBe(
      'SOFA ESQUINERO CIRO 2.20 MTS LINO MARFIL – contado $1.349.000 o 24 cuotas de $99.900',
    );
  });

  test('image_url is built from the configured base and is null without a picture', async () => {
    const fixture = catalog.map((p) =>
      p.id === '23541108' ? { ...p, image_file: '23541108.png' } : p.id === '23541112' ? { ...p, image_file: null } : p,
    );
    const client = await connect(fixture);
    expect((await call(client, 'get_product', { sku: '23541108' })).structuredContent?.image_url).toBe(
      `${BASE}/23541108.png`,
    );
    expect((await call(client, 'get_product', { sku: '23541112' })).structuredContent?.image_url).toBeNull();
    const found = await call(client, 'search_products', { query: 'MTB' });
    expect(found.structuredContent?.products[0].image_url).toBe(`${BASE}/23541108.png`);
  });
});

describe('list_categories', () => {
  test('counts every category, in the fixed order', async () => {
    const result = await call(await connect(), 'list_categories', {});
    expect(result.structuredContent?.categories).toEqual([
      { category: 'bicicletas', count: 4 },
      { category: 'motos eléctricas', count: 2 },
      { category: 'jardín', count: 2 },
      { category: 'dormitorio', count: 3 },
      { category: 'electrodomésticos', count: 3 },
      { category: 'cuidado personal', count: 2 },
      { category: 'sillones y sofás', count: 4 },
    ]);
  });
});

describe('image helpers', () => {
  test('imageUrl is null when the product has no file', () => {
    expect(imageUrl({ ...catalog[0]!, image_file: null }, BASE)).toBeNull();
  });

  test('imageCaption falls back to the bare name when there is no price', () => {
    const robot = catalog.find((p) => p.id === '51551032')!;
    expect(imageCaption(robot)).toBe(robot.name);
  });
});
