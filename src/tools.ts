import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  type Catalog,
  type Product,
  DEFAULT_LIMIT,
  didYouMean,
  discountPercent,
  findProduct,
  resolveCategory,
  searchProducts,
} from './catalog.js';
import { CATEGORIES } from './categories.js';

export interface ServerOptions {
  /** Where the product pictures are hosted, without a trailing slash. */
  imageBaseUrl: string;
}

const pesos = new Intl.NumberFormat('es-AR');
const formatPrice = (value: number | null): string => (value === null ? 'price on request' : `$${pesos.format(value)}`);

export function imageUrl(product: Product, imageBaseUrl: string): string | null {
  return product.image_file === null ? null : `${imageBaseUrl}/${product.image_file}`;
}

/** A Spanish one-liner, ready to be an image caption in a customer-facing message. */
export function imageCaption(product: Product): string {
  if (product.cash_price === null) {
    return product.name;
  }
  const instalments =
    product.installment_24 === null ? '' : ` o 24 cuotas de $${pesos.format(product.installment_24)}`;
  return `${product.name} – contado $${pesos.format(product.cash_price)}${instalments}`;
}

const summarySchema = z.object({
  id: z.string(),
  sku: z.string().nullable(),
  name: z.string(),
  category: z.string(),
  cash_price: z.number().nullable(),
  installment_24: z.number().nullable(),
  image_url: z.string().nullable(),
});

const summarise = (product: Product, imageBaseUrl: string): z.infer<typeof summarySchema> => ({
  id: product.id,
  sku: product.sku,
  name: product.name,
  category: product.category,
  cash_price: product.cash_price,
  installment_24: product.installment_24,
  image_url: imageUrl(product, imageBaseUrl),
});

const failure = (text: string) => ({ isError: true as const, content: [{ type: 'text' as const, text }] });

export function createCatalogServer(catalog: Catalog, options: ServerOptions): McpServer {
  const server = new McpServer({ name: 'erp-mock-mcp', version: '0.1.0' });
  registerCatalogTools(server, catalog, options);
  return server;
}

/** Registers `search_products`, `get_product` and `list_categories` on a server. */
export function registerCatalogTools(server: McpServer, catalog: Catalog, options: ServerOptions): void {
  const base = options.imageBaseUrl;

  server.registerTool(
    'search_products',
    {
      title: 'Search products',
      description:
        'Search the store catalog. All filters are optional and combine. `query` matches words in the product name ' +
        '(case, accents and a plural "s" are ignored; every word must match). `category` is one of: ' +
        `${CATEGORIES.join(', ')}. \`min_price\` and \`max_price\` are in Argentine pesos and apply to the cash ` +
        `price; products with no price are excluded when a price filter is given. Results are ordered by cash price, ` +
        `cheapest first, and limited to ${DEFAULT_LIMIT} unless \`limit\` (1 to 20) is given. ` +
        'A product without a price must be described as "price on request"; never invent a price.',
      inputSchema: {
        query: z.string().max(200).optional(),
        category: z.string().max(100).optional(),
        min_price: z.number().int().min(0).optional(),
        max_price: z.number().int().min(0).optional(),
        limit: z.number().int().min(1).max(20).optional(),
      },
      outputSchema: { total_matches: z.number().int(), products: z.array(summarySchema) },
      annotations: { readOnlyHint: true },
    },
    async ({ query, category, min_price, max_price, limit }) => {
      const resolved = category === undefined ? undefined : resolveCategory(category);
      if (category !== undefined && resolved === undefined) {
        return failure(`Unknown category "${category}". Valid categories: ${CATEGORIES.join(', ')}.`);
      }
      const result = searchProducts(catalog, {
        ...(query !== undefined && { query }),
        ...(resolved !== undefined && { category: resolved }),
        ...(min_price !== undefined && { minPrice: min_price }),
        ...(max_price !== undefined && { maxPrice: max_price }),
        ...(limit !== undefined && { limit }),
      });
      const lines = result.products.map((p) => {
        const picture = imageUrl(p, base);
        return `${p.id} | ${p.name} | cash ${formatPrice(p.cash_price)} | 24 instalments of ${formatPrice(p.installment_24)}${picture === null ? '' : ` | image ${picture}`}`;
      });
      return {
        content: [
          { type: 'text' as const, text: [`${result.totalMatches} match(es), showing ${lines.length}:`, ...lines].join('\n') },
        ],
        structuredContent: {
          total_matches: result.totalMatches,
          products: result.products.map((p) => summarise(p, base)),
        },
      };
    },
  );

  server.registerTool(
    'get_product',
    {
      title: 'Get a product',
      description:
        'Get the full record of one product by SKU. Accepts the product id, its SKU, or the SKU of one of its ' +
        'variants. Returns list price (the struck-through price), cash price, the monthly amount for 24 ' +
        'instalments on bank-issued cards, the derived discount percentage, the variants, a picture URL when there ' +
        'is one, and a ready-made Spanish caption. If the product has no price, `availability_note` says ' +
        '"price on request": say so and do not invent a number.',
      inputSchema: { sku: z.string().min(1).max(100) },
      outputSchema: {
        id: z.string(),
        sku: z.string().nullable(),
        name: z.string(),
        category: z.string(),
        list_price: z.number().nullable(),
        cash_price: z.number().nullable(),
        installment_24: z.number().nullable(),
        currency: z.literal('ARS'),
        discount_percent: z.number().nullable(),
        availability_note: z.string().nullable(),
        variants: z.array(z.object({ sku: z.string(), label: z.string().nullable() })),
        image_url: z.string().nullable(),
        image_caption: z.string(),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ sku }) => {
      const product = findProduct(catalog, sku);
      if (product === undefined) {
        const candidates = didYouMean(catalog, sku);
        const hint = candidates.length > 0 ? ` Did you mean: ${candidates.join(', ')}?` : '';
        return failure(`No product with SKU "${sku}".${hint}`);
      }
      const record = {
        id: product.id,
        sku: product.sku,
        name: product.name,
        category: product.category,
        list_price: product.list_price,
        cash_price: product.cash_price,
        installment_24: product.installment_24,
        currency: product.currency,
        discount_percent: discountPercent(product),
        availability_note: product.availability_note,
        variants: product.variants,
        image_url: imageUrl(product, base),
        image_caption: imageCaption(product),
      };
      const text = [
        `${product.id} | ${product.name} (${product.category})`,
        `list ${formatPrice(product.list_price)} | cash ${formatPrice(product.cash_price)} | 24 instalments of ${formatPrice(product.installment_24)}`,
        ...(record.discount_percent === null ? [] : [`discount ${record.discount_percent}%`]),
        ...(product.availability_note === null ? [] : [product.availability_note]),
        ...(product.variants.length === 0
          ? []
          : [`variants: ${product.variants.map((v) => (v.label === null ? v.sku : `${v.sku} (${v.label})`)).join(', ')}`]),
        ...(record.image_url === null ? [] : [`image ${record.image_url}`]),
      ].join('\n');
      return { content: [{ type: 'text' as const, text }], structuredContent: record };
    },
  );

  server.registerTool(
    'list_categories',
    {
      title: 'List categories',
      description: 'List the product categories of the store with how many products each holds.',
      inputSchema: {},
      outputSchema: { categories: z.array(z.object({ category: z.string(), count: z.number().int() })) },
      annotations: { readOnlyHint: true },
    },
    async () => {
      const categories = CATEGORIES.map((category) => ({
        category,
        count: catalog.filter((p) => p.category === category).length,
      }));
      return {
        content: [{ type: 'text' as const, text: categories.map((c) => `${c.category}: ${c.count}`).join('\n') }],
        structuredContent: { categories },
      };
    },
  );
}
