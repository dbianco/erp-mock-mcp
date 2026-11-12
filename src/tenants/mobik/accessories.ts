import { z } from 'zod';

/** Reads accessories from the store's public WooCommerce Store API (`/wp-json/wc/store/v1/products`). */

export const AccessorySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  categories: z.array(z.string()),
  /** Null when the store publishes no usable price ("price on request"). */
  price_ars: z.number().positive().nullable(),
  /** "Original" or "Certificado" when the store says so. */
  type: z.string().nullable(),
  compatible_models: z.array(z.string()),
  colors: z.array(z.string()),
  description: z.string(),
  in_stock: z.boolean(),
  url: z.string(),
});
export type Accessory = z.infer<typeof AccessorySchema>;

const StoreProductSchema = z.object({
  name: z.string().min(1),
  slug: z.string().min(1),
  permalink: z.string(),
  short_description: z.string(),
  prices: z.object({ price: z.string(), currency_code: z.string(), currency_minor_unit: z.number().int().min(0) }),
  categories: z.array(z.object({ name: z.string(), slug: z.string() })),
  attributes: z.array(z.object({ name: z.string(), terms: z.array(z.object({ name: z.string() })) })),
  is_in_stock: z.boolean(),
});
const StoreResponseSchema = z.array(StoreProductSchema);

/** The parent category every accessory carries; it says nothing, so it is dropped from the list. */
const ROOT_CATEGORY = 'accesorios';
/** The store uses 0 and 1 peso as placeholders for "no price yet". */
const PLACEHOLDER_PRICE = 1;

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', nbsp: ' ', '#39': "'", '#039': "'", '#8221': '"', '#8220': '"' };
const plainText = (html: string): string =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(#?\w+);/g, (match, name: string) => ENTITIES[name] ?? match)
    .replace(/\s+/g, ' ')
    .trim();

const termsOf = (product: z.infer<typeof StoreProductSchema>, attribute: string): string[] =>
  product.attributes.find((a) => a.name.toLowerCase().startsWith(attribute))?.terms.map((t) => t.name) ?? [];

export function parseAccessories(payload: unknown): Accessory[] {
  const accessories = StoreResponseSchema.parse(payload).map((product): Accessory => {
    if (product.prices.currency_code !== 'ARS') {
      throw new Error(`Accessory ${product.slug} is priced in ${product.prices.currency_code}, expected ARS`);
    }
    const price = Number(product.prices.price) / 10 ** product.prices.currency_minor_unit;
    return {
      id: product.slug,
      name: plainText(product.name),
      categories: product.categories.filter((c) => c.slug !== ROOT_CATEGORY).map((c) => c.name),
      price_ars: Number.isFinite(price) && price > PLACEHOLDER_PRICE ? price : null,
      type: termsOf(product, 'tipo')[0] ?? null,
      compatible_models: termsOf(product, 'modelo'),
      colors: termsOf(product, 'color'),
      description: plainText(product.short_description),
      in_stock: product.is_in_stock,
      url: product.permalink,
    };
  });
  if (new Set(accessories.map((a) => a.id)).size !== accessories.length) {
    throw new Error('Store API repeats an accessory slug');
  }
  return accessories;
}
