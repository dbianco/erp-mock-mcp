import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  DISCLAIMER,
  type ForecastDay,
  ForecastDaySchema,
  type Locality,
  LocalitySchema,
  loadForecasts,
  resolveLocality,
  suggestLocalities,
} from './weather.js';

export const failure = (text: string) => ({ isError: true as const, content: [{ type: 'text' as const, text }] });

/** The error for a locality that is not in the dataset: it lists the valid ones so the model can retry. */
export function unknownLocality(localities: readonly Locality[], input: string) {
  const hint = suggestLocalities(localities, input);
  return failure(
    `Unknown locality "${input}".${hint.length > 0 ? ` Did you mean: ${hint.join(', ')}?` : ''} ` +
      `Valid localities: ${localities.map((l) => l.name).join(', ')}.`,
  );
}

const dayLine = (d: ForecastDay): string =>
  `${d.date}: ${d.condition}, ${d.min_c}°C to ${d.max_c}°C, rain ${d.rain_probability_percent}%, wind ${d.wind_kmh} km/h ${d.wind_direction}`;

export function registerForecastTools(server: McpServer, localities: readonly Locality[]): void {
  const forecasts = loadForecasts();

  server.registerTool(
    'list_localities',
    {
      title: 'List localities',
      description: `List the localities of Córdoba province this service has weather data for. ${DISCLAIMER}.`,
      inputSchema: {},
      outputSchema: { localities: z.array(LocalitySchema), disclaimer: z.string() },
      annotations: { readOnlyHint: true },
    },
    async () => ({
      content: [{ type: 'text' as const, text: [...localities.map((l) => `${l.name} (${l.department})`), DISCLAIMER].join('\n') }],
      structuredContent: { localities: [...localities], disclaimer: DISCLAIMER },
    }),
  );

  server.registerTool(
    'get_forecast',
    {
      title: 'Weather forecast',
      description:
        'Weather forecast for one locality of Córdoba: today by default, or the extended 5-day forecast with `extended` = true. ' +
        'Minimum and maximum temperature, condition, rain probability and wind. The data is demonstration data, not an ' +
        `official forecast: when asked how reliable it is, say "${DISCLAIMER}". Use list_localities for valid names.`,
      inputSchema: { locality: z.string().min(1).max(100), extended: z.boolean().optional() },
      outputSchema: {
        locality: z.string(),
        reference_date: z.string(),
        extended: z.boolean(),
        days: z.array(ForecastDaySchema),
        disclaimer: z.string(),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ locality, extended }) => {
      const found = resolveLocality(localities, locality);
      if (found === undefined) {
        return unknownLocality(localities, locality);
      }
      const series = forecasts.by_locality[found.slug] ?? [];
      const days = extended === true ? series : series.slice(0, 1);
      return {
        content: [{ type: 'text' as const, text: [`Forecast for ${found.name}:`, ...days.map(dayLine), DISCLAIMER].join('\n') }],
        structuredContent: {
          locality: found.name,
          reference_date: forecasts.reference_date,
          extended: extended === true,
          days,
          disclaimer: DISCLAIMER,
        },
      };
    },
  );
}
