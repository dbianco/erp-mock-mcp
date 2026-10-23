import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import { type BusinessInfo, type DayKey, isOpenAt, parseAt, registerBusinessInfoTool } from './business-info.js';
import { dataFile, loadJson } from './data.js';

const session = [
  { open: '08:00', close: '12:00' },
  { open: '16:30', close: '20:30' },
];
const weekday = (day: DayKey) => ({ day, ranges: session });
const info: BusinessInfo = {
  name: 'Test Shop',
  address: 'Calle 1',
  phone: '000',
  email: null,
  hours: [
    weekday('mon'),
    weekday('tue'),
    weekday('wed'),
    weekday('thu'),
    weekday('fri'),
    { day: 'sat', ranges: [{ open: '08:30', close: '12:30' }] },
    { day: 'sun', ranges: [] },
  ],
  links: { web: 'https://example.test/' },
  notes: [],
};
// 2026-10-23 is a Friday.
const at = (text: string): boolean | null => isOpenAt(info, parseAt(text));

describe('isOpenAt', () => {
  test('is true on Friday 10:00 Córdoba time', () => {
    expect(at('2026-10-23T10:00:00')).toBe(true);
  });

  test('is false between sessions on Friday 13:00 and true at 16:30', () => {
    expect(at('2026-10-23T13:00:00')).toBe(false);
    expect(at('2026-10-23T16:30:00')).toBe(true);
  });

  test('is closed on the closing minute and open on the opening minute', () => {
    expect(at('2026-10-23T12:00:00')).toBe(false);
    expect(at('2026-10-23T08:00:00')).toBe(true);
    expect(at('2026-10-23T20:30:00')).toBe(false);
  });

  test('is true on Saturday 09:00, false on Saturday 13:00 and false on Sunday 10:00', () => {
    expect(at('2026-10-24T09:00:00')).toBe(true);
    expect(at('2026-10-24T13:00:00')).toBe(false);
    expect(at('2026-10-25T10:00:00')).toBe(false);
  });

  test('honours an explicit offset', () => {
    expect(at('2026-10-23T13:00:00Z')).toBe(true); // 10:00 in Córdoba
  });

  test('uses the Córdoba day just past UTC midnight', () => {
    expect(at('2026-10-24T01:00:00Z')).toBe(false); // Friday 22:00 local
    expect(at('2026-10-24T12:00:00Z')).toBe(true); // Saturday 09:00 local
  });

  test('is null when hours are unpublished', () => {
    expect(isOpenAt({ ...info, hours: null }, parseAt('2026-10-23T10:00:00'))).toBeNull();
  });
});

describe('parseAt', () => {
  test.each(['mañana', '2026-13-45T99:00:00', ''])('rejects %j mentioning ISO 8601', (text) => {
    expect(() => parseAt(text)).toThrow(/ISO 8601/);
  });
});

describe('loadJson and dataFile', () => {
  test('loads and validates a tenant data file', () => {
    const rows = loadJson(z.array(z.object({ id: z.string() })), dataFile('casa-gigli', 'catalog.json'));
    expect(rows.length).toBeGreaterThan(0);
  });

  test('names the file when validation fails', () => {
    expect(() => loadJson(z.array(z.object({ nope: z.string() })), dataFile('casa-gigli', 'catalog.json'))).toThrow(
      /catalog\.json/,
    );
  });
});

async function connect(source: BusinessInfo): Promise<Client> {
  const server = new McpServer({ name: 'test', version: '1' });
  registerBusinessInfoTool(server, source);
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
const call = async (client: Client, args: Record<string, unknown>) =>
  (await client.callTool({ name: 'get_business_info', arguments: args })) as ToolResult;

describe('get_business_info', () => {
  test('answers open_now only when at is given', async () => {
    const client = await connect(info);
    const without = await call(client, {});
    expect(without.structuredContent).toMatchObject({ name: 'Test Shop', open_now: null, checked_at: null });
    const withAt = await call(client, { at: '2026-10-23T10:00:00' });
    expect(withAt.structuredContent).toMatchObject({ open_now: true, checked_at: '2026-10-23T10:00:00' });
  });

  test('reports an isError result naming ISO 8601 for a bad at', async () => {
    const result = await call(await connect(info), { at: 'mañana' });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('ISO 8601');
  });

  test('open_now stays null when hours are unpublished', async () => {
    const result = await call(await connect({ ...info, hours: null }), { at: '2026-10-23T10:00:00' });
    expect(result.structuredContent?.open_now).toBeNull();
  });
});
