import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { loadBusinessInfo, registerBusinessInfoTool } from '../../business-info.js';
import type { Tenant } from '../../tenant.js';
import { z } from 'zod';
import { dataFile, loadJson } from '../../data.js';
import { TipSchema } from '../../tips.js';
import { ServiceSchema, registerServiceTools, registerTyreTools } from './tools.js';
import { loadTyres } from './tyres.js';

const SLUG = 'guemes';

export function createGuemesTenant(): Tenant {
  const business = loadBusinessInfo(SLUG);
  const tyres = loadTyres();
  const services = loadJson(z.array(ServiceSchema), dataFile(SLUG, 'services.json'));
  const tips = loadJson(z.array(TipSchema), dataFile(SLUG, 'tips.json'));
  return {
    slug: SLUG,
    name: 'Güemes Neumáticos',
    createServer: () => {
      const server = new McpServer({ name: 'erp-mock-mcp', version: '0.1.0' });
      registerBusinessInfoTool(server, business);
      registerTyreTools(server, tyres);
      registerServiceTools(server, services, tips);
      return server;
    },
  };
}
