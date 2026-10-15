import { describe, expect, test } from 'vitest';
import { parsePrice } from './prices.js';

describe('parsePrice', () => {
  test('reads the struck-through format: dots as thousands, comma as decimals', () => {
    expect(parsePrice('1.499.007,73')).toBe(1499008);
    expect(parsePrice('369.994,61')).toBe(369995);
    expect(parsePrice('2.799.102,46')).toBe(2799102);
  });

  test('reads the dollar format: commas as thousands, dot as decimals', () => {
    expect(parsePrice('$1,249,000.00')).toBe(1249000);
    expect(parsePrice('$87,449.00')).toBe(87449);
    expect(parsePrice('$299,999.00')).toBe(299999);
  });

  test('an empty cell is no price, not zero', () => {
    expect(parsePrice('')).toBeNull();
    expect(parsePrice('   ')).toBeNull();
  });

  test('rejects text that is not a price rather than guessing', () => {
    expect(() => parsePrice('abc')).toThrow(/Unparseable price/);
    expect(() => parsePrice('$')).toThrow(/Unparseable price/);
  });
});
