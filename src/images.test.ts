import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { loadCatalog } from './catalog.js';

const root = (relative: string): URL => new URL(`../${relative}`, import.meta.url);
const catalog = loadCatalog();
const sources: Record<string, { file: string; source_page: string; fetched: string; verified: boolean }> = JSON.parse(
  readFileSync(root('data/image-sources.json'), 'utf8'),
);
const withImage = catalog.filter((p) => p.image_file !== null);

const MIN_IMAGES = 2; // verified count from `ls assets/images | wc -l` on 2026-10-15

describe('image bundle', () => {
  test('enough products have a picture (guards against silently losing them)', () => {
    expect(withImage.length).toBeGreaterThanOrEqual(MIN_IMAGES);
    expect(withImage.length).toBe(Object.values(sources).filter((s) => s.verified).length);
  });

  test('every catalog image exists as a JPEG of at most 200000 bytes', () => {
    for (const product of withImage) {
      const file = root(`assets/images/${product.image_file}`);
      expect(existsSync(file), `${product.id} file`).toBe(true);
      expect(statSync(file).size, `${product.id} size`).toBeLessThanOrEqual(200000);
      const head = readFileSync(file).subarray(0, 3);
      expect([...head], `${product.id} JPEG magic bytes`).toEqual([0xff, 0xd8, 0xff]);
    }
  });

  test('there is no file in the bundle that the catalog does not use, and none is WebP', () => {
    const used = new Set(withImage.map((p) => p.image_file));
    const present = readdirSync(root('assets/images')).filter((f) => !f.startsWith('.'));
    expect(present.filter((f) => !used.has(f))).toEqual([]);
    expect(present.some((f) => f.toLowerCase().endsWith('.webp'))).toBe(false);
  });

  test('every verified source has an https page and a date', () => {
    for (const [id, source] of Object.entries(sources)) {
      expect(source.source_page, id).toMatch(/^https:\/\//);
      expect(source.fetched, id).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(source.file, id).toBe(`${id}.jpg`);
    }
  });

  test('the default image URLs are https, under 2048 characters and never WebP', () => {
    const base = 'https://casagigli.com.ar/mcp/images';
    for (const product of withImage) {
      const url = `${base}/${product.image_file}`;
      expect(url.startsWith('https://')).toBe(true);
      expect(url.length).toBeLessThan(2048);
      expect(url.toLowerCase().endsWith('.webp')).toBe(false);
    }
  });
});
