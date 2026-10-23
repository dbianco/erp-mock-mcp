import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { normalise } from '../../text.js';
import { TipSchema, type Tip } from '../../tips.js';
import {
  DEFAULT_LIMIT,
  type Tyre,
  VEHICLE_TYPES,
  type VehicleType,
  didYouMean,
  findTyre,
  searchTyres,
} from './tyres.js';

const pesos = new Intl.NumberFormat('es-AR');
const money = (value: number): string => `$${pesos.format(value)}`;
const failure = (text: string) => ({ isError: true as const, content: [{ type: 'text' as const, text }] });

const tyreSchema = z.object({
  id: z.string(),
  sku: z.string(),
  brand: z.string(),
  model: z.string(),
  size: z.string(),
  vehicle_type: z.enum(VEHICLE_TYPES),
  list_price: z.number(),
  cash_price: z.number(),
  currency: z.literal('ARS'),
  note: z.string().nullable(),
});

const record = (t: Tyre): z.infer<typeof tyreSchema> => ({ ...t, currency: 'ARS' });
const line = (t: Tyre): string =>
  `${t.id} | ${t.brand} ${t.model} ${t.size} (${t.vehicle_type}) | list ${money(t.list_price)} | cash ${money(t.cash_price)}`;

export function registerTyreTools(server: McpServer, tyres: readonly Tyre[]): void {
  server.registerTool(
    'search_products',
    {
      title: 'Search tyres',
      description:
        'Search the tyre catalog of the shop. All filters are optional and combine. `query` matches words in brand, model ' +
        'or size; `size` is a tyre size such as "205/55 R16" (any spacing or case); `brand` ignores case and accents; ' +
        `\`category\` is the vehicle type: ${VEHICLE_TYPES.join(', ')}. \`min_price\` and \`max_price\` are in Argentine ` +
        `pesos and apply to the cash price. Results are ordered by cash price, cheapest first, limited to ${DEFAULT_LIMIT} ` +
        'unless `limit` (1 to 20) is given. Prices are fixed demo prices: quote only what the tool returns, never invent one.',
      inputSchema: {
        query: z.string().max(200).optional(),
        size: z.string().max(40).optional(),
        brand: z.string().max(100).optional(),
        category: z.string().max(100).optional(),
        min_price: z.number().int().min(0).optional(),
        max_price: z.number().int().min(0).optional(),
        limit: z.number().int().min(1).max(20).optional(),
      },
      outputSchema: { total_matches: z.number().int(), products: z.array(tyreSchema) },
      annotations: { readOnlyHint: true },
    },
    async ({ query, size, brand, category, min_price, max_price, limit }) => {
      const vehicleType = category === undefined ? undefined : VEHICLE_TYPES.find((v) => v === category.trim().toLowerCase());
      if (category !== undefined && vehicleType === undefined) {
        return failure(`Unknown category "${category}". Valid categories: ${VEHICLE_TYPES.join(', ')}.`);
      }
      const result = searchTyres(tyres, {
        ...(query !== undefined && { query }),
        ...(size !== undefined && { size }),
        ...(brand !== undefined && { brand }),
        ...(vehicleType !== undefined && { vehicleType: vehicleType as VehicleType }),
        ...(min_price !== undefined && { minPrice: min_price }),
        ...(max_price !== undefined && { maxPrice: max_price }),
        ...(limit !== undefined && { limit }),
      });
      const text = [`${result.totalMatches} match(es), showing ${result.tyres.length}:`, ...result.tyres.map(line)].join('\n');
      return {
        content: [{ type: 'text' as const, text }],
        structuredContent: { total_matches: result.totalMatches, products: result.tyres.map(record) },
      };
    },
  );

  server.registerTool(
    'get_product',
    {
      title: 'Get a tyre',
      description: 'Get the full record of one tyre by its SKU (the same as its id): brand, model, size, vehicle type, list and cash price.',
      inputSchema: { sku: z.string().min(1).max(100) },
      outputSchema: tyreSchema.shape,
      annotations: { readOnlyHint: true },
    },
    async ({ sku }) => {
      const tyre = findTyre(tyres, sku);
      if (tyre === undefined) {
        const candidates = didYouMean(tyres, sku);
        return failure(`No tyre with SKU "${sku}".${candidates.length > 0 ? ` Did you mean: ${candidates.join(', ')}?` : ''}`);
      }
      return {
        content: [{ type: 'text' as const, text: [line(tyre), ...(tyre.note === null ? [] : [tyre.note])].join('\n') }],
        structuredContent: record(tyre),
      };
    },
  );

  server.registerTool(
    'list_categories',
    {
      title: 'List vehicle types',
      description: 'List the vehicle types the tyre catalog is organised by, with how many tyres each holds.',
      inputSchema: {},
      outputSchema: { categories: z.array(z.object({ category: z.string(), count: z.number().int() })) },
      annotations: { readOnlyHint: true },
    },
    async () => {
      const categories = VEHICLE_TYPES.map((category) => ({
        category,
        count: tyres.filter((t) => t.vehicle_type === category).length,
      }));
      return {
        content: [{ type: 'text' as const, text: categories.map((c) => `${c.category}: ${c.count}`).join('\n') }],
        structuredContent: { categories },
      };
    },
  );
}

export const ServiceSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  from_price: z.number().int().positive(),
  unit: z.string(),
  duration_minutes: z.number().int().positive(),
  includes: z.array(z.string()),
});
export type Service = z.infer<typeof ServiceSchema>;

export function registerServiceTools(server: McpServer, services: readonly Service[], tips: readonly Tip[]): void {
  server.registerTool(
    'list_services',
    {
      title: 'Workshop services',
      description:
        'List the workshop services of the shop (wheel balancing, shock-absorber replacement, tyre rotation, alignment, ' +
        'tyre fitting) with a starting price in Argentine pesos, what the price is per, the duration and what is included. ' +
        '`from_price` is a starting price, not a quote: say so and do not invent a final price.',
      inputSchema: {},
      outputSchema: { services: z.array(ServiceSchema) },
      annotations: { readOnlyHint: true },
    },
    async () => ({
      content: [
        {
          type: 'text' as const,
          text: services
            .map((s) => `${s.name} | from ${money(s.from_price)} ${s.unit} | ~${s.duration_minutes} min | ${s.includes.join(', ')}`)
            .join('\n'),
        },
      ],
      structuredContent: { services: [...services] },
    }),
  );

  const topics = [...new Set(tips.map((t) => t.topic))];
  server.registerTool(
    'get_maintenance_tips',
    {
      title: 'Maintenance tips',
      description:
        `Tyre and suspension maintenance advice. Optional \`topic\` (case and accents ignored) is one of: ${topics.join(', ')}. ` +
        'Give the advice as returned; do not add intervals or figures the tool does not state.',
      inputSchema: { topic: z.string().max(100).optional() },
      outputSchema: { tips: z.array(TipSchema) },
      annotations: { readOnlyHint: true },
    },
    async ({ topic }) => {
      const wanted = topic === undefined ? undefined : normalise(topic.trim());
      const selected = wanted === undefined ? tips : tips.filter((t) => normalise(t.topic) === wanted);
      if (wanted !== undefined && selected.length === 0) {
        return failure(`Unknown topic "${topic}". Valid topics: ${topics.join(', ')}.`);
      }
      return {
        content: [{ type: 'text' as const, text: selected.map((t) => `[${t.topic}] ${t.title}: ${t.text}`).join('\n') }],
        structuredContent: { tips: [...selected] },
      };
    },
  );
}
