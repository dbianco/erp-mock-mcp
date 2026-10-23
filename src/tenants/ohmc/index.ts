import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Tenant } from '../../tenant.js';
import { registerForecastTools } from './tools.js';
import { loadLocalities } from './weather.js';

const SLUG = 'ohmc';

export function createOhmcTenant(): Tenant {
  const localities = loadLocalities();
  return {
    slug: SLUG,
    name: 'Observatorio Hidro-Meteorológico Córdoba',
    createServer: () => {
      const server = new McpServer({ name: 'erp-mock-mcp', version: '0.1.0' });
      registerForecastTools(server, localities);
      return server;
    },
  };
}
