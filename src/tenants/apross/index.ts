import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { loadBusinessInfo, registerBusinessInfoTool } from '../../business-info.js';
import type { Tenant } from '../../tenant.js';
import { registerAprossTools } from './tools.js';

const SLUG = 'apross';

export function createAprossTenant(): Tenant {
  const business = loadBusinessInfo(SLUG);
  return {
    slug: SLUG,
    name: 'APROSS (Administración Provincial del Seguro de Salud)',
    createServer: () => {
      const server = new McpServer({ name: 'erp-mock-mcp', version: '0.1.0' });
      registerBusinessInfoTool(server, business);
      registerAprossTools(server);
      return server;
    },
  };
}
