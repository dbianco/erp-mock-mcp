import { createHttpServer } from './http.js';
import { DEFAULT_TENANT, createTenants } from './registry.js';

const port = Number(process.env.PORT ?? 8788);
if (!Number.isInteger(port) || port < 0 || port > 65535) {
  throw new Error(`PORT must be an integer between 0 and 65535, got "${process.env.PORT}"`);
}
const imageBaseUrl = (process.env.IMAGE_BASE_URL ?? 'https://casagigli.com.ar/mcp/images').replace(/\/+$/, '');
const authToken = process.env.MCP_AUTH_TOKEN;

const mobikTtlSeconds = Number(process.env.MOBIK_CACHE_TTL_SECONDS ?? 60);
if (!Number.isFinite(mobikTtlSeconds) || mobikTtlSeconds < 0) {
  throw new Error(`MOBIK_CACHE_TTL_SECONDS must be a number of seconds, zero or more, got "${process.env.MOBIK_CACHE_TTL_SECONDS}"`);
}
const mobikHolder = process.env.MOBIK_RESERVATION_HOLDER;
const mobikCbu = process.env.MOBIK_RESERVATION_CBU;

const tenants = createTenants({
  imageBaseUrl,
  mobik: {
    ttlSeconds: mobikTtlSeconds,
    reservation: { ...(mobikHolder && { holder: mobikHolder }), ...(mobikCbu && { cbu: mobikCbu }) },
  },
});
const server = createHttpServer({
  tenants,
  defaultTenant: DEFAULT_TENANT,
  ...(authToken !== undefined && { authToken }),
});

server.listen(port, '127.0.0.1', () => {
  console.log(
    `erp-mock-mcp listening on http://127.0.0.1:${port}/mcp ` +
      `(tenants ${[...tenants.keys()].join(', ')}; /mcp = ${DEFAULT_TENANT}; auth ${authToken ? 'on' : 'off'}, images from ${imageBaseUrl})`,
  );
});
