import { loadCatalog } from '../src/catalog.js';

const base = (process.env.IMAGE_BASE_URL ?? 'https://casagigli.com.ar/mcp/images').replace(/\/+$/, '');
const catalog = loadCatalog();
let failures = 0;

for (const product of catalog.filter((p) => p.image_file !== null)) {
  const url = `${base}/${product.image_file}`;
  const response = await fetch(url, { method: 'HEAD' });
  const type = response.headers.get('content-type') ?? '';
  const good = response.status === 200 && type.startsWith('image/jpeg');
  console.log(`${good ? 'ok  ' : 'FAIL'} ${product.id} ${response.status} ${type}`);
  if (!good) {
    failures += 1;
  }
}

if (failures > 0) {
  console.error(`${failures} image(s) are not reachable at ${base}`);
  process.exit(1);
}
console.log('all images reachable');
