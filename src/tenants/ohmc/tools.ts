import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { dataFile, loadJson } from '../../data.js';
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

const AlertSchema = z.object({
  id: z.string(),
  level: z.enum(['amarillo', 'naranja', 'rojo']),
  type: z.string(),
  localities: z.array(z.string()),
  validity_text: z.string(),
  description: z.string(),
  recommended_action: z.string(),
});
type Alert = z.infer<typeof AlertSchema>;

const ConditionsSchema = z.object({
  observed_at: z.string(),
  by_locality: z.record(
    z.string(),
    z.object({
      temperature_c: z.number(),
      humidity_percent: z.number().min(0).max(100),
      pressure_hpa: z.number(),
      wind_kmh: z.number().min(0),
      wind_direction: z.string(),
    }),
  ),
});

const StationSchema = z.object({
  name: z.string(),
  kind: z.enum(['river', 'dam']),
  locality: z.string(),
  level_m: z.number().nullable(),
  capacity_percent: z.number().nullable(),
  trend: z.enum(['rising', 'steady', 'falling']),
});

const LinkSchema = z.object({ name: z.string(), url: z.string().startsWith('https://'), description: z.string() });

export function registerWeatherTools(server: McpServer, localities: readonly Locality[]): void {
  const alerts = loadJson(z.array(AlertSchema), dataFile('ohmc', 'alerts.json'));
  const conditions = loadJson(ConditionsSchema, dataFile('ohmc', 'conditions.json'));
  const stations = loadJson(z.array(StationSchema), dataFile('ohmc', 'hydrology.json'));
  const links = loadJson(z.array(LinkSchema), dataFile('ohmc', 'links.json'));
  const nameOf = (slug: string): string => localities.find((l) => l.slug === slug)?.name ?? slug;

  server.registerTool(
    'get_active_alerts',
    {
      title: 'Active alerts',
      description:
        'Weather alerts currently in force in Córdoba, with level (amarillo, naranja, rojo), type, affected localities, ' +
        'validity text and a recommended action. Pass `locality` to see only the alerts that cover it; no alerts for a ' +
        `locality is a normal answer. ${DISCLAIMER}: these are demonstration alerts, not official warnings.`,
      inputSchema: { locality: z.string().max(100).optional() },
      outputSchema: { alerts: z.array(AlertSchema), disclaimer: z.string() },
      annotations: { readOnlyHint: true },
    },
    async ({ locality }) => {
      let selected: Alert[] = alerts;
      if (locality !== undefined) {
        const found = resolveLocality(localities, locality);
        if (found === undefined) {
          return unknownLocality(localities, locality);
        }
        selected = alerts.filter((a) => a.localities.includes(found.slug));
      }
      const text = [
        `${selected.length} active alerts${locality === undefined ? '' : ` for ${locality.trim()}`}:`,
        ...selected.map(
          (a) =>
            `${a.level.toUpperCase()} ${a.type} (${a.localities.map(nameOf).join(', ')}) | ${a.validity_text} | ${a.description} | ${a.recommended_action}`,
        ),
        DISCLAIMER,
      ].join('\n');
      return { content: [{ type: 'text' as const, text }], structuredContent: { alerts: selected, disclaimer: DISCLAIMER } };
    },
  );

  server.registerTool(
    'get_current_conditions',
    {
      title: 'Current conditions',
      description:
        'Latest observation of the automatic weather station for one locality: temperature, humidity, pressure and wind. ' +
        `\`observed_at\` is the time of the observation. ${DISCLAIMER}.`,
      inputSchema: { locality: z.string().min(1).max(100) },
      outputSchema: {
        locality: z.string(),
        observed_at: z.string(),
        temperature_c: z.number(),
        humidity_percent: z.number(),
        pressure_hpa: z.number(),
        wind_kmh: z.number(),
        wind_direction: z.string(),
        disclaimer: z.string(),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ locality }) => {
      const found = resolveLocality(localities, locality);
      const reading = found === undefined ? undefined : conditions.by_locality[found.slug];
      if (found === undefined || reading === undefined) {
        return unknownLocality(localities, locality);
      }
      const text = [
        `${found.name} at ${conditions.observed_at}: ${reading.temperature_c}°C, humidity ${reading.humidity_percent}%, ` +
          `pressure ${reading.pressure_hpa} hPa, wind ${reading.wind_kmh} km/h ${reading.wind_direction}`,
        DISCLAIMER,
      ].join('\n');
      return {
        content: [{ type: 'text' as const, text }],
        structuredContent: { locality: found.name, observed_at: conditions.observed_at, ...reading, disclaimer: DISCLAIMER },
      };
    },
  );

  server.registerTool(
    'get_hydrological_levels',
    {
      title: 'River and dam levels',
      description:
        'Levels of rivers (in metres) and fill percentage of dams, with their trend (rising, steady, falling). ' +
        `Pass \`locality\` to see only the stations of that locality. ${DISCLAIMER}.`,
      inputSchema: { locality: z.string().max(100).optional() },
      outputSchema: { stations: z.array(StationSchema), disclaimer: z.string() },
      annotations: { readOnlyHint: true },
    },
    async ({ locality }) => {
      let selected = stations;
      if (locality !== undefined) {
        const found = resolveLocality(localities, locality);
        if (found === undefined) {
          return unknownLocality(localities, locality);
        }
        selected = stations.filter((s) => s.locality === found.slug);
      }
      const text = [
        ...selected.map(
          (s) =>
            `${s.name} (${nameOf(s.locality)}): ${s.level_m === null ? `${s.capacity_percent}% of capacity` : `${s.level_m} m`}, ${s.trend}`,
        ),
        DISCLAIMER,
      ].join('\n');
      return {
        content: [{ type: 'text' as const, text }],
        structuredContent: { stations: selected.map((s) => ({ ...s, locality: nameOf(s.locality) })), disclaimer: DISCLAIMER },
      };
    },
  );

  server.registerTool(
    'get_monitoring_links',
    {
      title: 'Monitoring links',
      description:
        'Links to the real sources the observatory points to: regional WRF model, weather radar, GOES satellite imagery, ' +
        'REPROMMAT, the provincial water portal and the national weather service. For official warnings send people to the national weather service.',
      inputSchema: {},
      outputSchema: { links: z.array(LinkSchema) },
      annotations: { readOnlyHint: true },
    },
    async () => ({
      content: [{ type: 'text' as const, text: links.map((l) => `${l.name}: ${l.url} — ${l.description}`).join('\n') }],
      structuredContent: { links },
    }),
  );
}
