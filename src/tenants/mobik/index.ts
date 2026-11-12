import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { loadBusinessInfo, registerBusinessInfoTool } from '../../business-info.js';
import type { Tenant } from '../../tenant.js';
import { type SourceOptions, createSources } from './sources.js';
import { type ReservationSecrets, loadPolicies, registerMobikTools } from './tools.js';

const SLUG = 'mobik';

export interface MobikOptions extends SourceOptions {
  reservation?: ReservationSecrets;
}

/**
 * Mobik is the one tenant that reads live: its catalog comes from the store's site at request time, behind a cache
 * shared by every request (the sources are built once here, not per server).
 */
export function createMobikTenant(options: MobikOptions = {}): Tenant {
  const business = loadBusinessInfo(SLUG);
  const policies = loadPolicies();
  const sources = createSources(options);
  return {
    slug: SLUG,
    name: 'Mobik iPhones',
    createServer: () => {
      const server = new McpServer({ name: 'erp-mock-mcp', version: '0.1.0' });
      registerBusinessInfoTool(server, business);
      registerMobikTools(server, sources, policies, options.reservation ?? {});
      return server;
    },
  };
}
