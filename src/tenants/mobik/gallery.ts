import { z } from 'zod';
import { normalise } from '../../text.js';

/**
 * Pictures of the store's products, as public URLs the agent can attach to a WhatsApp reply. They are the store's own
 * catalog pictures: illustrative of a model and color, never a photo of the unit on sale.
 */

const IMAGE_HOST = 'mobikiphones.com.ar';

/**
 * The original upload behind a WordPress picture URL: a resized rendition carries a `-<width>x<height>` suffix before
 * the extension (`…-naranja-400x488.png`), and the original is the same path without it. Returns null for anything that
 * is not an https picture on the store's host, or that is WebP, which WhatsApp refuses.
 */
export function fullSizeImage(src: string): string | null {
  let url: URL;
  try {
    url = new URL(src);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.hostname !== IMAGE_HOST || !/\.(png|jpe?g)$/i.test(url.pathname)) {
    return null;
  }
  url.pathname = url.pathname.replace(/-\d+x\d+(\.\w+)$/, '$1');
  url.search = '';
  url.hash = '';
  return url.toString();
}

export interface GalleryImage {
  /** Normalised description the store gave the picture ("iphone 15 pro negro camaras"). */
  label: string;
  url: string;
}
/** Pictures by normalised model name ("15 pro max"). */
export type Gallery = Record<string, GalleryImage[]>;

const StoreProductSchema = z.array(
  z.object({ name: z.string(), images: z.array(z.object({ src: z.string(), alt: z.string().nullable().optional(), name: z.string().nullable().optional() })) }),
);

const modelKey = (name: string): string =>
  normalise(name)
    .replace(/\b(apple|iphone|sellado)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** Reads the iPhone products of the Store API (`products?category=iphones`) into a gallery; products with no usable picture are skipped. */
export function parseGallery(payload: unknown): Gallery {
  const gallery: Gallery = {};
  for (const product of StoreProductSchema.parse(payload)) {
    const images = product.images
      .map((image) => ({ label: normalise(image.alt || image.name || ''), url: fullSizeImage(image.src) }))
      .filter((image): image is GalleryImage => image.url !== null && image.label !== '');
    if (images.length > 0) {
      gallery[modelKey(product.name)] = [...(gallery[modelKey(product.name)] ?? []), ...images];
    }
  }
  return gallery;
}

/** The words the store's picture descriptions use for each color name of the price list. */
const COLOR_WORDS: Record<string, string[]> = {
  midnight: ['negro'],
  negro: ['negro'],
  purple: ['violeta', 'lila'],
  lavanda: ['lila', 'lavanda'],
  silver: ['plateado', 'plata', 'blanco', 'gris'],
  blanco: ['blanco'],
  gris: ['gris'],
  'gris natural': ['gris', 'natural'],
  'azul sierra': ['azul', 'celeste'],
  azul: ['azul', 'celeste'],
  blue: ['azul', 'celeste'],
  celeste: ['celeste', 'azul'],
  orange: ['naranja'],
};

/** Detail shots are less useful as "the phone in this color" than a whole-phone picture. */
const DETAIL = /camara|lateral|borde|pantalla|zoom|caja|costado|frente|colores/;

/**
 * The best picture of a model in a color, or null. Among the model's pictures whose description names the color, a
 * whole-phone picture beats a detail shot, then the shortest description wins, then the URL, so the pick is stable.
 */
export function pickColorImage(gallery: Gallery, model: string, color: string): string | null {
  const key = normalise(color.trim());
  const words = COLOR_WORDS[key] ?? [key];
  const candidates = (gallery[modelKey(model)] ?? []).filter((image) => words.some((word) => image.label.split(' ').includes(word)));
  const rank = (image: GalleryImage): number => words.findIndex((word) => image.label.split(' ').includes(word)) * 10 + (DETAIL.test(image.label) ? 1 : 0);
  candidates.sort((a, b) => rank(a) - rank(b) || a.label.length - b.label.length || a.url.localeCompare(b.url));
  return candidates[0]?.url ?? null;
}
