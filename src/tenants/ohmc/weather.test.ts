import { describe, expect, test } from 'vitest';
import { loadForecasts, loadLocalities, resolveLocality, suggestLocalities } from './weather.js';

const localities = loadLocalities();
const forecasts = loadForecasts();

describe('resolveLocality', () => {
  test.each([
    [' río cuarto ', 'Río Cuarto'],
    ['RIO CUARTO', 'Río Cuarto'],
    ['Cordoba', 'Córdoba'],
    ['villa-carlos-paz', 'Villa Carlos Paz'],
    ['villa maria', 'Villa María'],
  ])('ignores case, accents and surrounding spaces: %j', (input, name) => {
    expect(resolveLocality(localities, input)?.name).toBe(name);
  });

  test('returns undefined for an unknown locality', () => {
    expect(resolveLocality(localities, 'Atlantis')).toBeUndefined();
    expect(resolveLocality(localities, '')).toBeUndefined();
  });
});

describe('suggestLocalities', () => {
  test('suggests both Villa localities for "Villa"', () => {
    expect(suggestLocalities(localities, 'Villa')).toEqual(expect.arrayContaining(['Villa Carlos Paz', 'Villa María']));
  });
});

describe('the weather dataset', () => {
  test('covers at least the four required localities', () => {
    const names = localities.map((l) => l.name);
    expect(names).toEqual(expect.arrayContaining(['Córdoba', 'Villa Carlos Paz', 'Río Cuarto', 'Villa María']));
  });

  test('has a 5-day series per locality, consecutive from the reference date', () => {
    expect(forecasts.reference_date).toBe('2026-10-23');
    for (const locality of localities) {
      const days = forecasts.by_locality[locality.slug];
      expect(days, locality.slug).toHaveLength(5);
      expect(days?.map((d) => d.date)).toEqual(['2026-10-23', '2026-10-24', '2026-10-25', '2026-10-26', '2026-10-27']);
      for (const day of days ?? []) {
        expect(day.min_c).toBeLessThanOrEqual(day.max_c);
        expect(day.rain_probability_percent).toBeGreaterThanOrEqual(0);
        expect(day.rain_probability_percent).toBeLessThanOrEqual(100);
      }
    }
  });
});
