import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { loadBusinessInfo, registerBusinessInfoTool } from '../../business-info.js';
import type { Tenant } from '../../tenant.js';
import { registerTyreTools } from './tools.js';
import { loadTyres } from './tyres.js';

const SLUG = 'guemes';

export function createGuemesTenant(): Tenant {
  const business = loadBusinessInfo(SLUG);
  const tyres = loadTyres();
  return {
    slug: SLUG,
    name: 'Güemes Neumáticos',
    createServer: () => {
      const server = new McpServer({ name: 'erp-mock-mcp', version: '0.1.0' });
      registerBusinessInfoTool(server, business);
      registerTyreTools(server, tyres);
      return server;
    },
  };
}
