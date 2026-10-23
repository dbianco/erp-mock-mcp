import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, test } from 'vitest';
import { createCasaGigliTenant } from './casa-gigli.js';

interface ToolResult {
  isError?: boolean;
  content: { type: string; text: string }[];
  structuredContent?: Record<string, any>;
}

async function connect(): Promise<Client> {
  const server = createCasaGigliTenant({ imageBaseUrl: 'https://img.example/m' }).createServer();
  const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '1' });
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
  return client;
}
const call = async (client: Client, name: string, args: Record<string, unknown> = {}) =>
  (await client.callTool({ name, arguments: args })) as ToolResult;

describe('Casa Gigli tenant', () => {
  test('offers exactly five tools', async () => {
    const { tools } = await (await connect()).listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      'get_business_info',
      'get_product',
      'get_tips_and_offers',
      'list_categories',
      'search_products',
    ]);
  });

  test('business info carries the real contact data', async () => {
    const info = (await call(await connect(), 'get_business_info')).structuredContent;
    expect(info).toMatchObject({
      address: 'Héroes de Malvinas 271, X2563 Noetinger, Córdoba',
      phone: '03472 47-0066',
      links: { instagram: 'https://www.instagram.com/casa_gigli', web: 'https://casagigli.com.ar/' },
    });
  });

  test('is open Friday 10:00 and closed Sunday 10:00', async () => {
    const client = await connect();
    expect((await call(client, 'get_business_info', { at: '2026-10-23T10:00:00' })).structuredContent?.open_now).toBe(true);
    expect((await call(client, 'get_business_info', { at: '2026-10-25T10:00:00' })).structuredContent?.open_now).toBe(false);
  });

  test('closes Saturday at 12:30 and between sessions on weekdays', async () => {
    const client = await connect();
    expect((await call(client, 'get_business_info', { at: '2026-10-24T12:30:00' })).structuredContent?.open_now).toBe(false);
    expect((await call(client, 'get_business_info', { at: '2026-10-23T14:00:00' })).structuredContent?.open_now).toBe(false);
  });

  test('tips and offers: both by default, and kind narrows to one', async () => {
    const client = await connect();
    const both = (await call(client, 'get_tips_and_offers')).structuredContent!;
    expect(both.tips.length).toBeGreaterThanOrEqual(3);
    expect(both.offers.length).toBeGreaterThanOrEqual(3);
    const offers = (await call(client, 'get_tips_and_offers', { kind: 'offers' })).structuredContent!;
    expect(offers.tips).toEqual([]);
    expect(offers.offers).toEqual(both.offers);
    const tips = (await call(client, 'get_tips_and_offers', { kind: 'tips' })).structuredContent!;
    expect(tips.offers).toEqual([]);
  });

  test('the three catalog tools answer as before', async () => {
    const result = await call(await connect(), 'search_products', { query: 'bicicleta' });
    expect(result.structuredContent?.total_matches).toBeGreaterThanOrEqual(1);
    expect(result.structuredContent?.products[0]).toHaveProperty('cash_price');
  });
});
