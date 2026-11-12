import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  CONDITIONS,
  CURRENCIES,
  DEFAULT_LIMIT,
  type Currency,
  type Phone,
  brandCounts,
  cashPrice,
  didYouMean,
  findPhone,
  listPrice,
  searchPhones,
} from './phones.js';

const failure = (text: string) => ({ isError: true as const, content: [{ type: 'text' as const, text }] });
const money = (value: number | null, currency: Currency): string =>
  value === null
    ? 'price on request'
    : currency === 'ARS'
      ? `$${new Intl.NumberFormat('es-AR').format(value)} ARS`
      : `US$${new Intl.NumberFormat('en-US', { minimumFractionDigits: 2 }).format(value)}`;

const nullable = (schema: z.ZodNumber) => schema.nullable();
const phoneSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  brand: z.string(),
  condition: z.enum(CONDITIONS),
  storage_gb: nullable(z.number()),
  ram_gb: nullable(z.number()),
  colors: z.array(z.string()),
  battery_health_pct: nullable(z.number()),
  price_ars: nullable(z.number()),
  cash_price_ars: nullable(z.number()),
  price_usd: nullable(z.number()),
  cash_price_usd: nullable(z.number()),
  in_stock: z.boolean(),
  source_url: z.string(),
});

const line = (p: Phone): string =>
  `${p.slug} | ${p.name} | ${p.condition} | ${money(p.price_ars, 'ARS')} (cash ${money(p.cash_price_ars, 'ARS')}) | ${money(p.price_usd, 'USD')} (cash ${money(p.cash_price_usd, 'USD')})${p.in_stock ? '' : ' | out of stock'}`;

export function registerPhoneTools(server: McpServer, phones: readonly Phone[], readAt: string): void {
  server.registerTool(
    'search_products',
    {
      title: 'Search phones',
      description:
        'Search the phone catalog of the store. All filters are optional and combine. `query` matches words in the name ' +
        '(model, brand, "pro max"); `brand` ignores case and accents (see list_categories); `condition` is one of ' +
        `${CONDITIONS.join(', ')}; \`storage_gb\` and \`ram_gb\` are exact. \`min_price\` and \`max_price\` apply to the list ` +
        'price in `currency` (ARS pesos by default, or USD); phones with no published price are excluded when a price filter ' +
        `is given. Results are ordered by list price in that currency, cheapest first, phones with no price last, limited to ${DEFAULT_LIMIT} ` +
        'unless `limit` (1 to 20) is given. Each phone carries both the ARS and the USD list and cash price; a null price ' +
        `means "price on request": say so, never invent one. Prices are a snapshot read on ${readAt}, not live.`,
      inputSchema: {
        query: z.string().max(200).optional(),
        brand: z.string().max(100).optional(),
        condition: z.enum(CONDITIONS).optional(),
        storage_gb: z.number().int().min(1).optional(),
        ram_gb: z.number().int().min(1).optional(),
        min_price: z.number().min(0).optional(),
        max_price: z.number().min(0).optional(),
        currency: z.enum(CURRENCIES).optional(),
        in_stock_only: z.boolean().optional(),
        limit: z.number().int().min(1).max(20).optional(),
      },
      outputSchema: { total_matches: z.number().int(), currency: z.enum(CURRENCIES), products: z.array(phoneSchema) },
      annotations: { readOnlyHint: true },
    },
    async ({ query, brand, condition, storage_gb, ram_gb, min_price, max_price, currency, in_stock_only, limit }) => {
      const result = searchPhones(phones, {
        ...(query !== undefined && { query }),
        ...(brand !== undefined && { brand }),
        ...(condition !== undefined && { condition }),
        ...(storage_gb !== undefined && { storageGb: storage_gb }),
        ...(ram_gb !== undefined && { ramGb: ram_gb }),
        ...(min_price !== undefined && { minPrice: min_price }),
        ...(max_price !== undefined && { maxPrice: max_price }),
        ...(currency !== undefined && { currency }),
        ...(in_stock_only !== undefined && { inStockOnly: in_stock_only }),
        ...(limit !== undefined && { limit }),
      });
      const text = [`${result.totalMatches} match(es), showing ${result.phones.length}:`, ...result.phones.map(line)].join('\n');
      return {
        content: [{ type: 'text' as const, text }],
        structuredContent: { total_matches: result.totalMatches, currency: currency ?? 'ARS', products: result.phones },
      };
    },
  );

  server.registerTool(
    'get_product',
    {
      title: 'Get a phone',
      description:
        'Get the full record of one phone by its slug or numeric id (both come from search_products): condition, storage, RAM, ' +
        'colors, battery health of used units, list and cash price in ARS and USD, stock, and the page it was read from. ' +
        'A null price means "price on request".',
      inputSchema: { id: z.string().min(1).max(200) },
      outputSchema: phoneSchema.shape,
      annotations: { readOnlyHint: true },
    },
    async ({ id }) => {
      const phone = findPhone(phones, id);
      if (phone === undefined) {
        const candidates = didYouMean(phones, id);
        return failure(`No phone with id or slug "${id}".${candidates.length > 0 ? ` Did you mean: ${candidates.join(', ')}?` : ''}`);
      }
      const details = [
        line(phone),
        `storage ${phone.storage_gb ?? 'n/a'} GB, RAM ${phone.ram_gb ?? 'n/a'} GB`,
        `colors: ${phone.colors.length === 0 ? 'not listed' : phone.colors.join(', ')}`,
        ...(phone.battery_health_pct === null ? [] : [`battery health ${phone.battery_health_pct}%`]),
      ];
      return { content: [{ type: 'text' as const, text: details.join('\n') }], structuredContent: phone };
    },
  );

  server.registerTool(
    'list_categories',
    {
      title: 'List brands',
      description: 'List the brands the phone catalog is organised by, with how many models each holds and how many of them have a published price.',
      inputSchema: {},
      outputSchema: { categories: z.array(z.object({ category: z.string(), count: z.number().int(), priced: z.number().int() })) },
      annotations: { readOnlyHint: true },
    },
    async () => {
      const categories = brandCounts(phones).map(({ brand, count }) => ({
        category: brand,
        count,
        priced: phones.filter((p) => p.brand === brand && p.price_ars !== null).length,
      }));
      return {
        content: [{ type: 'text' as const, text: categories.map((c) => `${c.category}: ${c.count} (${c.priced} with price)`).join('\n') }],
        structuredContent: { categories },
      };
    },
  );

  server.registerTool(
    'compare_products',
    {
      title: 'Compare phones',
      description:
        'Compare two to four phones side by side by slug or id: price in ARS and USD, storage, RAM, condition and stock. ' +
        'Reports which one is cheapest in the chosen `currency` among those that have a price.',
      inputSchema: { ids: z.array(z.string().min(1).max(200)).min(2).max(4), currency: z.enum(CURRENCIES).optional() },
      outputSchema: { currency: z.enum(CURRENCIES), cheapest_id: z.string().nullable(), products: z.array(phoneSchema) },
      annotations: { readOnlyHint: true },
    },
    async ({ ids, currency }) => {
      const wanted: Currency = currency ?? 'ARS';
      const found = ids.map((id) => ({ id, phone: findPhone(phones, id) }));
      const missing = found.filter((f) => f.phone === undefined).map((f) => f.id);
      if (missing.length > 0) {
        return failure(`No phone with id or slug: ${missing.join(', ')}.`);
      }
      const products = found.map((f) => f.phone as Phone);
      const priced = products.filter((p) => listPrice(p, wanted) !== null);
      const cheapest = priced.sort((a, b) => (listPrice(a, wanted) as number) - (listPrice(b, wanted) as number))[0];
      const text = [
        ...products.map((p) => `${line(p)} | ${p.storage_gb ?? 'n/a'} GB / ${p.ram_gb ?? 'n/a'} GB RAM | cash ${money(cashPrice(p, wanted), wanted)}`),
        cheapest === undefined ? 'None of them has a published price.' : `Cheapest in ${wanted}: ${cheapest.name}.`,
      ].join('\n');
      return {
        content: [{ type: 'text' as const, text }],
        structuredContent: { currency: wanted, cheapest_id: cheapest?.id ?? null, products },
      };
    },
  );
}
