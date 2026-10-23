import { describe, expect, test } from 'vitest';
import { type Tyre, findTyre, loadTyres, searchTyres, sizeKey } from './tyres.js';

const tyres = loadTyres();

describe('sizeKey', () => {
  test('is equal for 205/55 R16 however it is spaced or cased', () => {
    expect(sizeKey('205/55 R16')).toBe(sizeKey('205/55R16'));
    expect(sizeKey('205/55 R16')).toBe(sizeKey('205/55r16'));
  });

  test('differs for another width or rim', () => {
    expect(sizeKey('205/60 R16')).not.toBe(sizeKey('205/55 R16'));
    expect(sizeKey('205/55 R17')).not.toBe(sizeKey('205/55 R16'));
  });
});

describe('the dataset', () => {
  test('has 15 tyres with unique ids and skus, cash price not above list, and all three vehicle types', () => {
    expect(tyres).toHaveLength(15);
    expect(new Set(tyres.map((t) => t.id)).size).toBe(15);
    expect(new Set(tyres.map((t) => t.sku)).size).toBe(15);
    for (const tyre of tyres) {
      expect(tyre.cash_price).toBeLessThanOrEqual(tyre.list_price);
    }
    expect(new Set(tyres.map((t) => t.vehicle_type))).toEqual(new Set(['auto', 'camioneta', 'moto']));
  });
});

describe('searchTyres', () => {
  test('size 205/55R16 finds every tyre of that size, whatever the spacing', () => {
    const expected = tyres.filter((t) => sizeKey(t.size) === sizeKey('205/55 R16')).map((t) => t.id);
    expect(expected.length).toBeGreaterThanOrEqual(2);
    expect(new Set(tyres.filter((t) => t.size === '205/55 R16').map((t) => t.brand)).size).toBeGreaterThanOrEqual(2);
    for (const size of ['205/55 R16', '205/55R16', '205/55r16', ' 205/55  R16 ']) {
      expect(
        searchTyres(tyres, { size, limit: 20 })
          .tyres.map((t) => t.id)
          .sort(),
      ).toEqual([...expected].sort());
    }
  });

  test('a brand filter ignores case and accents', () => {
    const brand = tyres[0]!.brand;
    const found = searchTyres(tyres, { brand: brand.toUpperCase(), limit: 20 });
    expect(found.totalMatches).toBeGreaterThanOrEqual(1);
    expect(found.tyres.every((t) => t.brand === brand)).toBe(true);
  });

  test('results are cheapest first', () => {
    const prices = searchTyres(tyres, { limit: 20 }).tyres.map((t) => t.cash_price);
    expect(prices).toEqual([...prices].sort((a, b) => a - b));
  });

  test('a search that matches nothing is a normal answer with zero matches', () => {
    expect(searchTyres(tyres, { query: 'zzzz-no-existe' })).toEqual({ totalMatches: 0, tyres: [] });
    expect(searchTyres(tyres, { size: '999/99 R99' }).totalMatches).toBe(0);
  });

  test('price filters apply to the cash price and the default limit is 5', () => {
    const cheapest = Math.min(...tyres.map((t) => t.cash_price));
    const found = searchTyres(tyres, { maxPrice: cheapest });
    expect(found.tyres.every((t) => t.cash_price <= cheapest)).toBe(true);
    expect(searchTyres(tyres, {}).tyres).toHaveLength(5);
    expect(searchTyres(tyres, {}).totalMatches).toBe(15);
  });

  test('vehicle type narrows the result', () => {
    const motos = searchTyres(tyres, { vehicleType: 'moto', limit: 20 });
    expect(motos.totalMatches).toBe(tyres.filter((t) => t.vehicle_type === 'moto').length);
  });

  test('a query matches brand and model words', () => {
    const t: Tyre = tyres[0]!;
    const found = searchTyres(tyres, { query: `${t.brand} ${t.model}`, limit: 20 });
    expect(found.tyres.map((x) => x.id)).toContain(t.id);
  });
});

describe('findTyre', () => {
  test('finds by id or sku, ignoring case', () => {
    const t = tyres[0]!;
    expect(findTyre(tyres, t.id.toLowerCase())?.id).toBe(t.id);
    expect(findTyre(tyres, t.sku)?.id).toBe(t.id);
    expect(findTyre(tyres, 'nope')).toBeUndefined();
  });
});
