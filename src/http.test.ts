import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, test } from 'vitest';
import { loadCatalog } from './catalog.js';
import { createHttpServer } from './http.js';

const catalog = loadCatalog();
const open: { close: () => Promise<void> }[] = [];

async function start(authToken?: string): Promise<string> {
  const server = createHttpServer({
    catalog,
    imageBaseUrl: 'https://img.example/m',
    ...(authToken !== undefined && { authToken }),
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  open.push({ close: () => new Promise<void>((resolve) => server.close(() => resolve())) });
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

afterEach(async () => {
  await Promise.all(open.splice(0).map((s) => s.close()));
});

async function client(url: string, token?: string): Promise<Client> {
  const transport = new StreamableHTTPClientTransport(new URL(`${url}/mcp`), {
    requestInit: token === undefined ? {} : { headers: { Authorization: `Bearer ${token}` } },
  });
  const c = new Client({ name: 'test', version: '1' });
  await c.connect(transport);
  return c;
}

const initialize = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 't', version: '1' } },
};
const post = (url: string, body: string, headers: Record<string, string> = {}) =>
  fetch(`${url}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers },
    body,
  });

describe('open server', () => {
  test('serves the health probe without authentication', async () => {
    const url = await start('secret');
    const response = await fetch(`${url}/health`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok' });
  });

  test('speaks MCP end to end: initialize, tools/list, tools/call', async () => {
    const c = await client(await start());
    expect((await c.listTools()).tools.map((t) => t.name).sort()).toEqual([
      'get_product',
      'list_categories',
      'search_products',
    ]);
    const result = (await c.callTool({ name: 'search_products', arguments: { query: 'sofa' } })) as unknown as {
      structuredContent: { total_matches: number };
    };
    expect(result.structuredContent.total_matches).toBe(2);
  });

  test('is stateless: a second independent client works without any session from the first', async () => {
    const url = await start();
    const first = await client(url);
    await first.listTools();
    const second = await client(url);
    expect((await second.listTools()).tools).toHaveLength(3);
  });
});

describe('bearer authentication', () => {
  test('refuses a missing header and a wrong token of the same length', async () => {
    const url = await start('s3cret-token');
    expect((await post(url, JSON.stringify(initialize))).status).toBe(401);
    const wrong = await post(url, JSON.stringify(initialize), { authorization: 'Bearer s3cret-tokeX' });
    expect(wrong.status).toBe(401);
  });

  test('review focus 4: a token of a different length is a 401, not a crash', async () => {
    const url = await start('s3cret-token');
    for (const header of ['Bearer x', 'Bearer ', 'Bearer s3cret-token-and-much-longer', 'Basic abc']) {
      expect((await post(url, JSON.stringify(initialize), { authorization: header })).status).toBe(401);
    }
    expect((await fetch(`${url}/health`)).status).toBe(200);
  });

  test('accepts the right token, and the MCP client can use it', async () => {
    const url = await start('s3cret-token');
    const c = await client(url, 's3cret-token');
    expect((await c.listTools()).tools).toHaveLength(3);
  });
});

describe('malformed requests', () => {
  test('review focus 5a: invalid JSON is a 400 JSON-RPC error and the server keeps serving', async () => {
    const url = await start();
    const response = await post(url, '{not json');
    expect(response.status).toBe(400);
    expect((await response.json()).error.message).toMatch(/not valid JSON/);
    expect((await fetch(`${url}/health`)).status).toBe(200);
  });

  test('review focus 5b: a body over 1 MiB is a 413 and the server keeps serving', async () => {
    const url = await start();
    const response = await post(url, JSON.stringify({ filler: 'a'.repeat(1_100_000) }));
    expect(response.status).toBe(413);
    expect((await fetch(`${url}/health`)).status).toBe(200);
  });

  test('GET on the MCP endpoint is 405 (stateless, POST only) and unknown paths are 404', async () => {
    const url = await start();
    const get = await fetch(`${url}/mcp`);
    expect(get.status).toBe(405);
    expect(get.headers.get('allow')).toBe('POST');
    expect((await fetch(`${url}/nope`)).status).toBe(404);
  });
});
