import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { timingSafeEqual } from 'node:crypto';
import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import type { Catalog } from './catalog.js';
import { createCatalogServer } from './tools.js';

const MAX_BODY_BYTES = 1_048_576;

export interface HttpOptions {
  catalog: Catalog;
  imageBaseUrl: string;
  /** When set and non-empty, `POST /mcp` requires `Authorization: Bearer <authToken>`. */
  authToken?: string;
}

type Body = { ok: true; value: unknown } | { ok: false; status: number; message: string };

const rpcError = (code: number, message: string) => ({ jsonrpc: '2.0', error: { code, message }, id: null });

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(payload));
}

function authorised(req: IncomingMessage, token: string | undefined): boolean {
  if (token === undefined || token === '') {
    return true;
  }
  const expected = Buffer.from(`Bearer ${token}`);
  const actual = Buffer.from(req.headers.authorization ?? '');
  // timingSafeEqual throws on unequal lengths, so the length is compared first.
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

async function readJson(req: IncomingMessage): Promise<Body> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = chunk as Buffer;
    size += buffer.length;
    if (size > MAX_BODY_BYTES) {
      return { ok: false, status: 413, message: 'Request body too large' };
    }
    chunks.push(buffer);
  }
  try {
    return { ok: true, value: JSON.parse(Buffer.concat(chunks).toString('utf8')) };
  } catch {
    return { ok: false, status: 400, message: 'Request body is not valid JSON' };
  }
}

async function handle(req: IncomingMessage, res: ServerResponse, options: HttpOptions): Promise<void> {
  const { pathname } = new URL(req.url ?? '/', 'http://localhost');

  if (pathname === '/health' && req.method === 'GET') {
    return sendJson(res, 200, { status: 'ok' });
  }
  if (pathname !== '/mcp') {
    return sendJson(res, 404, { error: 'not_found' });
  }
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return sendJson(res, 405, rpcError(-32000, 'Method not allowed: this server is stateless, use POST.'));
  }
  if (!authorised(req, options.authToken)) {
    res.setHeader('WWW-Authenticate', 'Bearer');
    return sendJson(res, 401, rpcError(-32001, 'Unauthorized'));
  }

  const body = await readJson(req);
  if (!body.ok) {
    res.setHeader('Connection', 'close');
    return sendJson(res, body.status, rpcError(-32700, body.message));
  }

  // One server and one transport per request: nothing is shared between callers.
  const mcp = createCatalogServer(options.catalog, { imageBaseUrl: options.imageBaseUrl });
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.on('close', () => {
    void transport.close();
    void mcp.close();
  });
  await mcp.connect(transport);
  await transport.handleRequest(req, res, body.value);
}

export function createHttpServer(options: HttpOptions): http.Server {
  return http.createServer((req, res) => {
    handle(req, res, options).catch((error: unknown) => {
      console.error('erp-mock-mcp request failed', error instanceof Error ? error.message : error);
      if (res.headersSent) {
        res.end();
      } else {
        sendJson(res, 500, rpcError(-32603, 'Internal error'));
      }
    });
  });
}
