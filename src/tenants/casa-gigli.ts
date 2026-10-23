import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { loadCatalog } from '../catalog.js';
import type { Tenant } from '../tenant.js';
import { type ServerOptions, registerCatalogTools } from '../tools.js';

export function createCasaGigliTenant(options: ServerOptions): Tenant {
  const catalog = loadCatalog();
  return {
    slug: 'casa-gigli',
    name: 'Casa Gigli',
    createServer: () => {
      const server = new McpServer({ name: 'erp-mock-mcp', version: '0.1.0' });
      registerCatalogTools(server, catalog, options);
      return server;
    },
  };
}
