import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, test } from 'vitest';
import { createHttpServer } from './http.js';
import { DEFAULT_TENANT, createTenants } from './registry.js';

const open: { close: () => Promise<void> }[] = [];

async function start(): Promise<string> {
  const server = createHttpServer({
    tenants: createTenants({ imageBaseUrl: 'https://img.example/m' }),
    defaultTenant: DEFAULT_TENANT,
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  open.push({ close: () => new Promise<void>((resolve) => server.close(() => resolve())) });
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

afterEach(async () => {
  await Promise.all(open.splice(0).map((s) => s.close()));
});

async function toolNames(url: string, path: string): Promise<string[]> {
  const client = new Client({ name: 'test', version: '1' });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${url}${path}`)));
  return (await client.listTools()).tools.map((t) => t.name).sort();
}

describe('tenant registry', () => {
  test('registers exactly apross, casa-gigli, guemes and ohmc', () => {
    expect([...createTenants({ imageBaseUrl: 'https://img.example/m' }).keys()].sort()).toEqual([
      'apross',
      'casa-gigli',
      'guemes',
      'ohmc',
    ]);
  });

  test("each real route lists exactly that tenant's tools and no other tenant's", async () => {
    const url = await start();
    const casaGigli = await toolNames(url, '/casa-gigli/mcp');
    const guemes = await toolNames(url, '/guemes/mcp');
    const ohmc = await toolNames(url, '/ohmc/mcp');
    const apross = await toolNames(url, '/apross/mcp');
    expect(casaGigli).toEqual(['get_business_info', 'get_product', 'get_tips_and_offers', 'list_categories', 'search_products']);
    expect(guemes).toEqual([
      'get_business_info',
      'get_maintenance_tips',
      'get_product',
      'list_categories',
      'list_services',
      'search_products',
    ]);
    expect(ohmc).toEqual([
      'get_active_alerts',
      'get_business_info',
      'get_current_conditions',
      'get_forecast',
      'get_hydrological_levels',
      'get_monitoring_links',
      'list_localities',
    ]);
    expect(apross).toEqual([
      'find_offices',
      'get_authorities',
      'get_business_info',
      'get_contacts',
      'get_health_program',
      'get_mobile_mammography',
      'list_health_programs',
    ]);
    expect(apross).not.toContain('search_products');
    expect(ohmc).not.toContain('search_products');
    expect(guemes).not.toContain('get_forecast');
    expect(casaGigli).not.toContain('list_services');
  });

  test('/mcp lists the same tools as /casa-gigli/mcp', async () => {
    const url = await start();
    expect(await toolNames(url, '/mcp')).toEqual(await toolNames(url, '/casa-gigli/mcp'));
  });
});
