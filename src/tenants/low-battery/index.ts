import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { loadBusinessInfo, registerBusinessInfoTool } from '../../business-info.js';
import type { Tenant } from '../../tenant.js';
import { loadSnapshot } from './phones.js';
import { registerPhoneTools } from './tools.js';

const SLUG = 'low-battery';

export function createLowBatteryTenant(): Tenant {
  const business = loadBusinessInfo(SLUG);
  const snapshot = loadSnapshot();
  return {
    slug: SLUG,
    name: 'Low Battery',
    createServer: () => {
      const server = new McpServer({ name: 'erp-mock-mcp', version: '0.1.0' });
      registerBusinessInfoTool(server, business);
      registerPhoneTools(server, snapshot.products, snapshot.read_at);
      return server;
    },
  };
}
