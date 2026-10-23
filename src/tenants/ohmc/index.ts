import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { loadBusinessInfo, registerBusinessInfoTool } from '../../business-info.js';
import type { Tenant } from '../../tenant.js';
import { registerForecastTools, registerWeatherTools } from './tools.js';
import { loadLocalities } from './weather.js';

const SLUG = 'ohmc';

export function createOhmcTenant(): Tenant {
  const localities = loadLocalities();
  const business = loadBusinessInfo(SLUG);
  return {
    slug: SLUG,
    name: 'Observatorio Hidro-Meteorológico Córdoba',
    createServer: () => {
      const server = new McpServer({ name: 'erp-mock-mcp', version: '0.1.0' });
      registerBusinessInfoTool(server, business);
      registerForecastTools(server, localities);
      registerWeatherTools(server, localities);
      return server;
    },
  };
}
