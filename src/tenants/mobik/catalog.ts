import { normalise, tokenise } from '../../text.js';
import type { Accessory } from './accessories.js';
import type { Iphone, IphoneCondition } from './price-list.js';

export const KINDS = ['iphone', 'accessory'] as const;
export type Kind = (typeof KINDS)[number];
export const DEFAULT_LIMIT = 5;

export interface CatalogSearch {
  query?: string;
  kind?: Kind;
  condition?: IphoneCondition;
  storageGb?: number;
  color?: string;
  minBatteryPct?: number;
  minPrice?: number;
  maxPrice?: number;
  limit?: number;
}

const CONDITION_WORDS: Record<IphoneCondition, string> = { new: 'nuevo nuevos sellado sellados new', used: 'usado usados seminuevo seminuevos used' };

const within = (value: number, min: number | undefined, max: number | undefined): boolean =>
  (min === undefined || value >= min) && (max === undefined || value <= max);

/**
 * Narrows a phone to the units that pass the color, battery and price filters. A sealed phone has no published units
 * or colors, so the color and battery filters let it through untouched. Returns undefined when nothing is left.
 */
function narrow(phone: Iphone, o: CatalogSearch): Iphone | undefined {
  if (phone.units.length === 0) {
    return within(phone.price_usd, o.minPrice, o.maxPrice) ? phone : undefined;
  }
  const color = o.color === undefined ? undefined : normalise(o.color.trim());
  const units = phone.units.filter(
    (u) =>
      (color === undefined || normalise(u.color).includes(color)) &&
      (o.minBatteryPct === undefined || u.battery_pct >= o.minBatteryPct) &&
      within(u.price_usd, o.minPrice, o.maxPrice),
  );
  return units.length === 0 ? undefined : { ...phone, units, price_usd: Math.min(...units.map((u) => u.price_usd)) };
}

export function searchIphones(phones: readonly Iphone[], o: CatalogSearch): Iphone[] {
  const tokens = tokenise(o.query ?? '');
  return phones
    .filter((p) => o.condition === undefined || p.condition === o.condition)
    .filter((p) => o.storageGb === undefined || p.storage_gb === o.storageGb)
    .filter((p) => {
      const text = normalise(`apple ${p.name} ${p.storage_gb}gb ${CONDITION_WORDS[p.condition]} ${p.units.map((u) => u.color).join(' ')}`);
      return tokens.every((token) => text.includes(token));
    })
    .map((p) => narrow(p, o))
    .filter((p): p is Iphone => p !== undefined)
    .sort((a, b) => a.price_usd - b.price_usd || a.id.localeCompare(b.id));
}

export function searchAccessories(accessories: readonly Accessory[], o: CatalogSearch): Accessory[] {
  const tokens = tokenise(o.query ?? '');
  const color = o.color === undefined ? undefined : normalise(o.color.trim());
  const priced = o.minPrice !== undefined || o.maxPrice !== undefined;
  return accessories
    .filter((a) => color === undefined || a.colors.some((c) => normalise(c).includes(color)))
    .filter((a) => !priced || (a.price_ars !== null && within(a.price_ars, o.minPrice, o.maxPrice)))
    .filter((a) => {
      const text = normalise(`accesorio ${a.name} ${a.categories.join(' ')} ${a.type ?? ''} ${a.compatible_models.join(' ')} ${a.colors.join(' ')} ${a.description}`);
      return tokens.every((token) => text.includes(token));
    })
    .sort((a, b) => {
      if (a.price_ars === null || b.price_ars === null) {
        return a.price_ars === b.price_ars ? a.id.localeCompare(b.id) : a.price_ars === null ? 1 : -1;
      }
      return a.price_ars - b.price_ars || a.id.localeCompare(b.id);
    });
}

export const findById = <T extends { id: string }>(items: readonly T[], key: string): T | undefined => {
  const wanted = normalise(key.trim());
  return items.find((item) => normalise(item.id) === wanted);
};

/** Up to three ids that contain every word of a key that matched nothing. */
export function didYouMean(ids: readonly string[], key: string): string[] {
  const tokens = tokenise(key.replace(/-/g, ' '));
  return tokens.length === 0 ? [] : ids.filter((id) => tokens.every((token) => id.includes(token))).slice(0, 3);
}
