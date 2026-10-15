import { describe, expect, test } from 'vitest';
import {
  type Product,
  DEFAULT_LIMIT,
  didYouMean,
  discountPercent,
  findProduct,
  loadCatalog,
  resolveCategory,
  searchProducts,
} from './catalog.js';
import { normalise, tokenise } from './text.js';

const catalog = loadCatalog();
const ids = (products: Product[]): string[] => products.map((p) => p.id);

describe('text normalisation', () => {
  test('lower-cases and strips accents', () => {
    expect(normalise('ELÉCTRICA Jardín')).toBe('electrica jardin');
  });

  test('tokenising strips punctuation at the edges of a word but keeps it inside', () => {
    expect(tokenise('¿Bicicletas ELÉCTRICAS?')).toEqual(['bicicletas', 'electricas']);
    expect(tokenise('bicicleta eléctrica.')).toEqual(['bicicleta', 'electrica']);
    expect(tokenise('GA.MA, 2,06m!')).toEqual(['ga.ma', '2,06m']);
    expect(tokenise('?!...')).toEqual([]);
  });

  test('tokenising drops empty tokens', () => {
    expect(tokenise('  Bicicletas   ELÉCTRICAS ')).toEqual(['bicicletas', 'electricas']);
    expect(tokenise('   ')).toEqual([]);
  });
});

describe('loadCatalog', () => {
  test('parses the generated file into 20 typed products', () => {
    expect(catalog).toHaveLength(20);
  });
});

describe('searchProducts', () => {
  test('a plain word matches every product with it in the name, cheapest first', () => {
    const all = searchProducts(catalog, { query: 'bicicleta' });
    expect(all.totalMatches).toBe(4);
    expect(ids(all.products)).toEqual(['23541108', '23541510', '23541512', '23541112']);
  });

  test('a price cap narrows the result, and the fixture proves the cap did the narrowing', () => {
    const unfiltered = searchProducts(catalog, { query: 'bicicleta' });
    const capped = searchProducts(catalog, { query: 'bicicleta', maxPrice: 300000 });
    expect(capped.totalMatches).not.toBe(unfiltered.totalMatches);
    expect(ids(capped.products)).toEqual(['23541108', '23541510']);
  });

  test('review focus 1: a shopper-typed query (case, accents, plural) finds the same product', () => {
    const typed = searchProducts(catalog, { query: 'Bicicletas ELÉCTRICAS' });
    const plain = searchProducts(catalog, { query: 'bicicleta electrica' });
    expect(ids(typed.products)).toEqual(['23541112']);
    expect(ids(plain.products)).toEqual(ids(typed.products));
    expect(ids(searchProducts(catalog, { query: 'ELÉCTRICAS' }).products)).toEqual([
      '23541112',
      '24785017',
      '24785019',
    ]);
  });

  test('final review: punctuation around a shopper-typed query does not hide the product', () => {
    const plain = ids(searchProducts(catalog, { query: 'bicicleta' }).products);
    for (const query of ['bicicleta?', '¿bicicletas?', 'bicicletas,', '  bicicleta. ']) {
      expect(ids(searchProducts(catalog, { query }).products), query).toEqual(plain);
    }
    expect(ids(searchProducts(catalog, { query: 'bicicletas, eléctricas.' }).products)).toEqual(['23541112']);
    // A query that is only punctuation says nothing, so it lists the default page.
    expect(searchProducts(catalog, { query: '?!' }).totalMatches).toBe(20);
  });

  test('final review: Spanish plurals ending in "es" find the singular product', () => {
    expect(ids(searchProducts(catalog, { query: 'tocadores' }).products)).toEqual(['14142253', '14142260']);
    expect(ids(searchProducts(catalog, { query: 'jardines' }).products)).toEqual(['16521066', '16521065']);
    expect(ids(searchProducts(catalog, { query: 'secadores' }).products)).toEqual(['51789019']);
  });

  test('review focus 2: an empty or blank query lists the five cheapest priced products', () => {
    for (const query of [undefined, '', '   ']) {
      const result = searchProducts(catalog, query === undefined ? {} : { query });
      expect(result.totalMatches).toBe(20);
      expect(ids(result.products)).toEqual([
        'PEABODY-PE-LMA327B',
        '51789019',
        '23541108',
        '14101015',
        '14142253',
      ]);
    }
    expect(DEFAULT_LIMIT).toBe(5);
  });

  test('review focus 3: an inverted price range is an empty result, not an error', () => {
    const result = searchProducts(catalog, { minPrice: 500000, maxPrice: 100000 });
    expect(result).toEqual({ totalMatches: 0, products: [] });
  });

  test('a category filter is exact and combines with a minimum price', () => {
    const result = searchProducts(catalog, { category: 'sillones y sofás', minPrice: 600000 });
    expect(ids(result.products)).toEqual(['14798012', '14798121', '14798061']);
  });

  test('a price filter excludes a priceless product that a text search still finds', () => {
    expect(ids(searchProducts(catalog, { query: 'robot' }).products)).toEqual(['51551032']);
    expect(searchProducts(catalog, { query: 'robot', maxPrice: 10_000_000 }).totalMatches).toBe(0);
  });

  test('limit caps the page but not the match count', () => {
    const result = searchProducts(catalog, { limit: 2 });
    expect(result.totalMatches).toBe(20);
    expect(result.products).toHaveLength(2);
  });

  test('a query matches variant labels as well as names', () => {
    expect(ids(searchProducts(catalog, { query: 'cinamomo' }).products)).toEqual(['14101015']);
  });

  test('a word that is only in a category name does not match the product text', () => {
    expect(ids(searchProducts(catalog, { query: 'sofa' }).products)).toEqual(['14798012', '14798061']);
  });
});

describe('resolveCategory', () => {
  test('ignores case and accents and rejects unknown names', () => {
    expect(resolveCategory('Sillones y Sofas')).toBe('sillones y sofás');
    expect(resolveCategory('JARDIN')).toBe('jardín');
    expect(resolveCategory('muebles')).toBeUndefined();
  });
});

describe('findProduct', () => {
  test('finds by id, by SKU and by a variant SKU, ignoring case and padding', () => {
    expect(findProduct(catalog, '14101003')?.id).toBe('14101015');
    expect(findProduct(catalog, ' 23541120 ')?.id).toBe('23541108');
    expect(findProduct(catalog, 'peabody-pe-lma327b')?.id).toBe('PEABODY-PE-LMA327B');
    expect(findProduct(catalog, '99999999')).toBeUndefined();
  });
});

describe('didYouMean', () => {
  test('suggests ids sharing the first five characters, at most three, in id order', () => {
    expect(didYouMean(catalog, '23541999')).toEqual(['23541108', '23541112', '23541510']);
    expect(didYouMean(catalog, 'ZZ')).toEqual([]);
  });
});

describe('discountPercent', () => {
  test('is the rounded percentage between list and cash price', () => {
    expect(discountPercent(findProduct(catalog, '23541112')!)).toBe(17);
  });

  test('is null when either price is missing', () => {
    expect(discountPercent(findProduct(catalog, '51551032')!)).toBeNull();
  });
});
