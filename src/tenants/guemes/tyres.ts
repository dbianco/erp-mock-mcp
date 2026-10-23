import { z } from 'zod';
import { dataFile, loadJson } from '../../data.js';
import { normalise, tokenise } from '../../text.js';

export const VEHICLE_TYPES = ['auto', 'camioneta', 'moto'] as const;
export type VehicleType = (typeof VEHICLE_TYPES)[number];

export const TyreSchema = z.object({
  id: z.string(),
  sku: z.string(),
  brand: z.string(),
  model: z.string(),
  size: z.string(),
  vehicle_type: z.enum(VEHICLE_TYPES),
  list_price: z.number().int(),
  cash_price: z.number().int(),
  note: z.string().nullable(),
});
export type Tyre = z.infer<typeof TyreSchema>;

export const DEFAULT_LIMIT = 5;

export const loadTyres = (): readonly Tyre[] => loadJson(z.array(TyreSchema), dataFile('guemes', 'tyres.json'));

/** Sizes compare by their digits only, so "205/55 R16", "205/55R16" and "205/55r16" are the same size. */
export const sizeKey = (size: string): string => size.replace(/\D/g, '');

export interface TyreSearch {
  query?: string;
  size?: string;
  brand?: string;
  vehicleType?: VehicleType;
  minPrice?: number;
  maxPrice?: number;
  limit?: number;
}

/** Cash price ascending, ties by id: deterministic, no relevance ranking. */
const byCashPrice = (a: Tyre, b: Tyre): number => a.cash_price - b.cash_price || a.id.localeCompare(b.id);

export function searchTyres(tyres: readonly Tyre[], o: TyreSearch): { totalMatches: number; tyres: Tyre[] } {
  const tokens = tokenise(o.query ?? '');
  const brand = o.brand === undefined ? undefined : normalise(o.brand.trim());
  const matched = tyres
    .filter((t) => o.vehicleType === undefined || t.vehicle_type === o.vehicleType)
    .filter((t) => o.size === undefined || sizeKey(t.size) === sizeKey(o.size))
    .filter((t) => brand === undefined || normalise(t.brand) === brand)
    .filter((t) => o.minPrice === undefined || t.cash_price >= o.minPrice)
    .filter((t) => o.maxPrice === undefined || t.cash_price <= o.maxPrice)
    .filter((t) => {
      const text = normalise(`${t.brand} ${t.model} ${t.size}`);
      return tokens.every((token) => text.includes(token));
    })
    .sort(byCashPrice);
  return { totalMatches: matched.length, tyres: matched.slice(0, o.limit ?? DEFAULT_LIMIT) };
}

export function findTyre(tyres: readonly Tyre[], key: string): Tyre | undefined {
  const wanted = key.trim().toUpperCase();
  return tyres.find((t) => t.id.toUpperCase() === wanted || t.sku.toUpperCase() === wanted);
}

export function didYouMean(tyres: readonly Tyre[], key: string): string[] {
  const prefix = key.trim().toUpperCase().slice(0, 4);
  return tyres
    .map((t) => t.id)
    .filter((id) => id.toUpperCase().startsWith(prefix))
    .sort()
    .slice(0, 3);
}
