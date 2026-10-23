import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, test } from 'vitest';
import { createHttpServer } from './http.js';
import { createCasaGigliTenant } from './tenants/casa-gigli.js';
import type { Tenant } from './tenant.js';

const open: { close: () => Promise<void> }[] = [];

/** A tiny tenant exposing one tool, so routing is tested independently of any real dataset. */
function fakeTenant(slug: string, tool: string): Tenant {
  return {
    slug,
    name: slug,
    createServer: () => {
      const server = new McpServer({ name: slug, version: '1' });
      server.registerTool(tool, { description: `tool of ${slug}`, annotations: { readOnlyHint: true } }, async () => ({
        content: [{ type: 'text' as const, text: slug }],
      }));
      return server;
    },
  };
}

const alpha = fakeTenant('alpha', 'only_alpha');
const beta = fakeTenant('beta', 'only_beta');
const twoTenants = new Map([
  ['alpha', alpha],
  ['beta', beta],
]);

async function start(authToken?: string, tenants: ReadonlyMap<string, Tenant> = twoTenants): Promise<string> {
  const server = createHttpServer({
    tenants,
    defaultTenant: 'alpha',
    ...(authToken !== undefined && { authToken }),
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  open.push({ close: () => new Promise<void>((resolve) => server.close(() => resolve())) });
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

afterEach(async () => {
  await Promise.all(open.splice(0).map((s) => s.close()));
});

async function client(url: string, token?: string, path = '/alpha/mcp'): Promise<Client> {
  const transport = new StreamableHTTPClientTransport(new URL(`${url}${path}`), {
    requestInit: token === undefined ? {} : { headers: { Authorization: `Bearer ${token}` } },
  });
  const c = new Client({ name: 'test', version: '1' });
  await c.connect(transport);
  return c;
}

const toolNames = async (c: Client) => (await c.listTools()).tools.map((t) => t.name).sort();

const initialize = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 't', version: '1' } },
};
const post = (url: string, body: string, headers: Record<string, string> = {}, path = '/alpha/mcp') =>
  fetch(`${url}${path}`, {
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
    const url = await start(undefined, new Map([['casa-gigli', createCasaGigliTenant({ imageBaseUrl: 'https://img.example/m' })]]));
    const c = await client(url, undefined, '/casa-gigli/mcp');
    expect(await toolNames(c)).toEqual(expect.arrayContaining(['get_product', 'list_categories', 'search_products']));
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
    expect(await toolNames(second)).toEqual(['only_alpha']);
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
    expect(await toolNames(c)).toEqual(['only_alpha']);
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

  test('GET on a tenant endpoint is 405 (stateless, POST only)', async () => {
    const url = await start();
    const get = await fetch(`${url}/alpha/mcp`);
    expect(get.status).toBe(405);
    expect(get.headers.get('allow')).toBe('POST');
  });
});

describe('tenant routing', () => {
  test('routes /alpha/mcp and /beta/mcp to their own tool lists', async () => {
    const url = await start();
    expect(await toolNames(await client(url, undefined, '/alpha/mcp'))).toEqual(['only_alpha']);
    expect(await toolNames(await client(url, undefined, '/beta/mcp'))).toEqual(['only_beta']);
  });

  test("calling another tenant's tool fails", async () => {
    const c = await client(await start(), undefined, '/alpha/mcp');
    const result = (await c.callTool({ name: 'only_beta', arguments: {} }).catch((e: unknown) => e)) as {
      isError?: boolean;
    };
    expect(result instanceof Error || result.isError === true).toBe(true);
  });

  test('/mcp answers as the default tenant', async () => {
    expect(await toolNames(await client(await start(), undefined, '/mcp'))).toEqual(['only_alpha']);
  });

  test.each(['/gamma/mcp', '/alpha/mcp/', '/ALPHA/mcp', '/a/b/mcp', '/alpha', '/nope'])(
    '%s is a 404 not_found',
    async (path) => {
      const url = await start();
      const response = await post(url, JSON.stringify(initialize), {}, path);
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: 'not_found' });
    },
  );

  test('an unknown slug is a 404 before the bearer check', async () => {
    const url = await start('s3cret-token');
    expect((await post(url, JSON.stringify(initialize), {}, '/gamma/mcp')).status).toBe(404);
  });

  test('authentication applies to every tenant route and /mcp, but not /health', async () => {
    const url = await start('s3cret-token');
    for (const path of ['/alpha/mcp', '/beta/mcp', '/mcp']) {
      expect((await post(url, JSON.stringify(initialize), {}, path)).status).toBe(401);
    }
    expect((await fetch(`${url}/health`)).status).toBe(200);
  });
});
