import { z } from 'zod';
import { dataFile, loadJson } from '../../data.js';
import { normalise } from '../../text.js';

/** Appended to every weather answer: the data is invented, and the model must not present it as real. */
export const DISCLAIMER = 'Datos de demostración, no oficiales';

export const LocalitySchema = z.object({ slug: z.string(), name: z.string(), department: z.string() });
export type Locality = z.infer<typeof LocalitySchema>;

export const ForecastDaySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  min_c: z.number(),
  max_c: z.number(),
  condition: z.string(),
  rain_probability_percent: z.number().min(0).max(100),
  wind_kmh: z.number().min(0),
  wind_direction: z.string(),
});
export type ForecastDay = z.infer<typeof ForecastDaySchema>;

const ForecastsSchema = z.object({
  /** The fixed "today" of the dataset: no tool reads the clock. */
  reference_date: z.string(),
  by_locality: z.record(z.string(), z.array(ForecastDaySchema)),
});

export const loadLocalities = (): readonly Locality[] =>
  loadJson(z.array(LocalitySchema), dataFile('ohmc', 'localities.json'));
export const loadForecasts = () => loadJson(ForecastsSchema, dataFile('ohmc', 'forecasts.json'));

/** Matches a locality by name or slug, ignoring case, accents and surrounding spaces. */
export function resolveLocality(localities: readonly Locality[], input: string): Locality | undefined {
  const wanted = normalise(input.trim());
  if (wanted === '') {
    return undefined;
  }
  return localities.find((l) => normalise(l.name) === wanted || l.slug === wanted);
}

/** Up to three locality names that start like the input, for an error message. */
export function suggestLocalities(localities: readonly Locality[], input: string): string[] {
  const prefix = normalise(input.trim()).slice(0, 4);
  return localities
    .filter((l) => prefix !== '' && normalise(l.name).startsWith(prefix))
    .map((l) => l.name)
    .slice(0, 3);
}
