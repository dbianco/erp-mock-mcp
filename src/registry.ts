import type { Tenant } from './tenant.js';
import { createCasaGigliTenant } from './tenants/casa-gigli.js';
import { createGuemesTenant } from './tenants/guemes/index.js';
import { createOhmcTenant } from './tenants/ohmc/index.js';

/** The tenant that answers the legacy `/mcp` path, so registrations made before multi-tenancy keep working. */
export const DEFAULT_TENANT = 'casa-gigli';

export interface RegistryOptions {
  imageBaseUrl: string;
}

export function createTenants(options: RegistryOptions): ReadonlyMap<string, Tenant> {
  const tenants = [createCasaGigliTenant({ imageBaseUrl: options.imageBaseUrl }), createGuemesTenant(), createOhmcTenant()];
  return new Map(tenants.map((tenant) => [tenant.slug, tenant]));
}
