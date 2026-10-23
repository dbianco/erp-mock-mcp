import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, test } from 'vitest';
import { createOhmcTenant } from './index.js';
import { DISCLAIMER } from './weather.js';

interface ToolResult {
  isError?: boolean;
  content: { type: string; text: string }[];
  structuredContent?: Record<string, any>;
}

async function connect(): Promise<Client> {
  const server = createOhmcTenant().createServer();
  const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '1' });
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
  return client;
}
const call = async (client: Client, name: string, args: Record<string, unknown> = {}) =>
  (await client.callTool({ name, arguments: args })) as ToolResult;

describe('OHMC forecast tools', () => {
  test('offers list_localities and get_forecast', async () => {
    const { tools } = await (await connect()).listTools();
    expect(tools.map((t) => t.name)).toEqual(expect.arrayContaining(['get_forecast', 'list_localities']));
  });

  test('list_localities names the four required localities', async () => {
    const { localities } = (await call(await connect(), 'list_localities')).structuredContent as {
      localities: { name: string }[];
    };
    expect(localities.map((l) => l.name)).toEqual(
      expect.arrayContaining(['Córdoba', 'Villa Carlos Paz', 'Río Cuarto', 'Villa María']),
    );
  });

  test('get_forecast defaults to today: one day dated 2026-10-23', async () => {
    const { structuredContent } = await call(await connect(), 'get_forecast', { locality: 'Córdoba' });
    expect(structuredContent).toMatchObject({ locality: 'Córdoba', reference_date: '2026-10-23', extended: false });
    expect(structuredContent?.days).toHaveLength(1);
    expect(structuredContent?.days[0].date).toBe('2026-10-23');
  });

  test('extended returns five days', async () => {
    const { structuredContent } = await call(await connect(), 'get_forecast', { locality: ' río cuarto ', extended: true });
    expect(structuredContent?.extended).toBe(true);
    expect(structuredContent?.days).toHaveLength(5);
  });

  test('every answer carries the disclaimer in text and structured content', async () => {
    const client = await connect();
    for (const [name, args] of [
      ['get_forecast', { locality: 'Córdoba' }],
      ['get_forecast', { locality: 'Córdoba', extended: true }],
    ] as const) {
      const result = await call(client, name, args);
      expect(result.content[0]?.text).toContain(DISCLAIMER);
      expect(result.structuredContent?.disclaimer).toBe(DISCLAIMER);
    }
  });

  test('an unknown locality is an isError result that lists the valid ones', async () => {
    const result = await call(await connect(), 'get_forecast', { locality: 'Atlantis' });
    expect(result.isError).toBe(true);
    for (const name of ['Córdoba', 'Villa Carlos Paz', 'Río Cuarto', 'Villa María']) {
      expect(result.content[0]?.text).toContain(name);
    }
  });
});
