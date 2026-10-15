import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { CATEGORIES } from './categories.js';

interface Row {
  id: string;
  sku: string | null;
  name: string;
  category: string;
  list_price: number | null;
  cash_price: number | null;
  installment_24: number | null;
  currency: string;
  variants: { sku: string; label: string | null }[];
  availability_note: string | null;
  image_file: string | null;
}

const rows: Row[] = JSON.parse(
  readFileSync(new URL('../data/catalog.json', import.meta.url), 'utf8'),
);
const byId = (id: string): Row => {
  const row = rows.find((r) => r.id === id);
  if (!row) throw new Error(`no product ${id}`);
  return row;
};

describe('generated catalog', () => {
  test('holds the 20 source rows with unique ids and no SKU collisions', () => {
    expect(rows).toHaveLength(20);
    expect(new Set(rows.map((r) => r.id)).size).toBe(20);
    // A product's own SKU legitimately reappears as its first variant, so dedupe per product
    // first and then require that no SKU belongs to two products.
    const skusPerProduct = rows.map((r) => new Set([r.sku, ...r.variants.map((v) => v.sku)].filter(Boolean)));
    const everySku = skusPerProduct.flatMap((set) => [...set]);
    expect(new Set(everySku).size).toBe(everySku.length);
    expect(everySku).toHaveLength(22);
  });

  test('every category is a known one and the counts match the source', () => {
    const counts = Object.fromEntries(CATEGORIES.map((c) => [c, rows.filter((r) => r.category === c).length]));
    expect(counts).toEqual({
      bicicletas: 4,
      'motos eléctricas': 2,
      jardín: 2,
      dormitorio: 3,
      electrodomésticos: 3,
      'cuidado personal': 2,
      'sillones y sofás': 4,
    });
  });

  test('prices are positive integers and the list price never undercuts the cash price', () => {
    for (const r of rows) {
      for (const price of [r.list_price, r.cash_price, r.installment_24]) {
        if (price !== null) {
          expect(Number.isInteger(price) && price > 0).toBe(true);
        }
      }
      if (r.list_price !== null && r.cash_price !== null) {
        expect(r.list_price).toBeGreaterThanOrEqual(r.cash_price);
      }
      expect(r.currency).toBe('ARS');
    }
  });

  test('both price formats came through intact', () => {
    expect(byId('23541112')).toMatchObject({ list_price: 1499008, cash_price: 1249000, installment_24: 87449 });
    expect(byId('14798061')).toMatchObject({ list_price: 1678875, cash_price: 1349000, installment_24: 99900 });
  });

  test('the kitchen robot has no price and says so', () => {
    expect(byId('51551032')).toMatchObject({
      list_price: null,
      cash_price: null,
      installment_24: null,
      availability_note: 'price on request',
    });
    expect(rows.filter((r) => r.availability_note !== null)).toHaveLength(1);
  });

  test('the blender without a SKU gets a stable generated id', () => {
    expect(byId('PEABODY-PE-LMA327B')).toMatchObject({ sku: null, cash_price: 113600 });
  });

  test('the two-SKU zapatero splits into two labelled variants', () => {
    const zapatero = byId('14101015');
    expect(zapatero.name).toBe('ZAPATERO HENN DUETTO D182');
    expect(zapatero.variants).toEqual([
      { sku: '14101015', label: 'D182-05 BLANCO HP' },
      { sku: '14101003', label: 'D182-214 CINAMOMO' },
    ]);
  });

  test('the three-SKU mountain bike is one product with three unlabelled variants', () => {
    const bike = byId('23541108');
    expect(bike.variants).toEqual([
      { sku: '23541108', label: null },
      { sku: '23541120', label: null },
      { sku: '23541107', label: null },
    ]);
  });

  test('single-SKU products carry no variants and no image yet', () => {
    expect(byId('14798012').variants).toEqual([]);
    expect(rows.every((r) => r.image_file === null)).toBe(true);
  });
});
