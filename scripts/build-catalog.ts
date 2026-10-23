import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { categoryFor } from '../src/categories.js';
import { parsePrice } from '../src/prices.js';

interface Variant {
  sku: string;
  label: string | null;
}

interface ImageSource {
  file: string;
  source_page: string;
  fetched: string;
  verified: boolean;
}

const here = (relative: string): URL => new URL(`../${relative}`, import.meta.url);

// Rows whose name or id cannot be derived mechanically. Keyed by the raw SKU cell, or by the
// product name when the SKU cell is empty.
const OVERRIDES: Record<string, { name?: string; id?: string; variants?: Variant[] }> = {
  '14101015-14101003': {
    name: 'ZAPATERO HENN DUETTO D182',
    variants: [
      { sku: '14101015', label: 'D182-05 BLANCO HP' },
      { sku: '14101003', label: 'D182-214 CINAMOMO' },
    ],
  },
  'LICUADORA DE MANO PEABODY PE-LMA327B BLANCA': { id: 'PEABODY-PE-LMA327B' },
};

const images: Record<string, ImageSource> = existsSync(here('data/casa-gigli/image-sources.json'))
  ? JSON.parse(readFileSync(here('data/casa-gigli/image-sources.json'), 'utf8'))
  : {};

const lines = readFileSync(here('data/casa-gigli/source-catalog.psv'), 'utf8').split('\n').filter((l) => l.trim() !== '');
const [, ...dataLines] = lines;

const products = dataLines.map((line) => {
  const [rawSku = '', rawName = '', rawList = '', rawCash = '', rawInstallment = ''] = line.split('|');
  const override = OVERRIDES[rawSku === '' ? rawName : rawSku] ?? {};
  const skus = rawSku.split('-').filter((s) => s !== '');
  const name = override.name ?? rawName;
  const id = override.id ?? skus[0];
  if (id === undefined) {
    throw new Error(`Row without a SKU and without an id override: "${rawName}"`);
  }
  const variants: Variant[] =
    override.variants ?? (skus.length > 1 ? skus.map((sku) => ({ sku, label: null })) : []);
  const cash = parsePrice(rawCash);
  const image = images[id];
  return {
    id,
    sku: skus[0] ?? null,
    name,
    category: categoryFor(name),
    list_price: parsePrice(rawList),
    cash_price: cash,
    installment_24: parsePrice(rawInstallment),
    currency: 'ARS' as const,
    variants,
    availability_note: cash === null ? 'price on request' : null,
    image_file: image?.verified === true ? image.file : null,
  };
});

writeFileSync(here('data/casa-gigli/catalog.json'), `${JSON.stringify(products, null, 2)}\n`);
console.log(`Wrote ${products.length} products to data/casa-gigli/catalog.json`);
