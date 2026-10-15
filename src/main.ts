import { loadCatalog } from './catalog.js';
import { createHttpServer } from './http.js';

const port = Number(process.env.PORT ?? 8788);
if (!Number.isInteger(port) || port < 0 || port > 65535) {
  throw new Error(`PORT must be an integer between 0 and 65535, got "${process.env.PORT}"`);
}
const imageBaseUrl = (process.env.IMAGE_BASE_URL ?? 'https://casagigli.com.ar/mcp/images').replace(/\/+$/, '');
const authToken = process.env.MCP_AUTH_TOKEN;

const catalog = loadCatalog();
const server = createHttpServer({ catalog, imageBaseUrl, ...(authToken !== undefined && { authToken }) });

server.listen(port, '127.0.0.1', () => {
  console.log(
    `erp-mock-mcp listening on http://127.0.0.1:${port}/mcp ` +
      `(${catalog.length} products, auth ${authToken ? 'on' : 'off'}, images from ${imageBaseUrl})`,
  );
});
