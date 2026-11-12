import type { Tenant } from './tenant.js';
import { createAprossTenant } from './tenants/apross/index.js';
import { createCasaGigliTenant } from './tenants/casa-gigli.js';
import { createGuemesTenant } from './tenants/guemes/index.js';
import { createLowBatteryTenant } from './tenants/low-battery/index.js';
import { type MobikOptions, createMobikTenant } from './tenants/mobik/index.js';
import { createOhmcTenant } from './tenants/ohmc/index.js';

/** The tenant that answers the legacy `/mcp` path, so registrations made before multi-tenancy keep working. */
export const DEFAULT_TENANT = 'casa-gigli';

export interface RegistryOptions {
  imageBaseUrl: string;
  mobik?: MobikOptions;
}

export function createTenants(options: RegistryOptions): ReadonlyMap<string, Tenant> {
  const tenants = [createCasaGigliTenant({ imageBaseUrl: options.imageBaseUrl }), createGuemesTenant(), createOhmcTenant(), createAprossTenant(), createLowBatteryTenant(), createMobikTenant(options.mobik)];
  return new Map(tenants.map((tenant) => [tenant.slug, tenant]));
}
