import { z } from 'zod';
import { normalise } from '../../text.js';
import { fullSizeImage } from './gallery.js';

/**
 * Reads the public price list of the store (`/lista-de-precios/`). The page ships its catalog and its trade-in
 * calculator as JavaScript literals inside one inline script; this module lifts those literals out and validates them.
 * Anything that does not match the expected shape throws, so the caller can fall back to the last good copy.
 */

export const IPHONE_CONDITIONS = ['new', 'used'] as const;
export type IphoneCondition = (typeof IPHONE_CONDITIONS)[number];

export const IphoneUnitSchema = z.object({
  battery_pct: z.number().int().min(1).max(100),
  color: z.string().min(1),
  price_usd: z.number().positive(),
  /** An illustrative picture of the model in this color, when the store has one; filled in when the catalog is served. */
  image_url: z.string().nullable(),
});
export type IphoneUnit = z.infer<typeof IphoneUnitSchema>;

export const IphoneSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  model: z.string().min(1),
  condition: z.enum(IPHONE_CONDITIONS),
  storage_gb: z.number().int().positive(),
  /** The "Desde" price the page prints for the model and capacity. */
  from_price_usd: z.number().positive(),
  /** The cheapest published unit, or the "Desde" price when the page lists no unit (sealed phones). */
  price_usd: z.number().positive(),
  /** One entry per published used unit; empty for sealed phones, whose colors the page does not list. */
  units: z.array(IphoneUnitSchema),
  /** The illustrative picture the price list shows for the model (no particular color), or null. */
  image_url: z.string().nullable(),
});
export type Iphone = z.infer<typeof IphoneSchema>;

export interface TradeIn {
  /** Internal reference value per model, keyed as the page keys it ("14 Pro", "18 Pro Sellado"). Never shown to customers. */
  values: Record<string, number>;
  margin: number;
  sealed18Margin: number;
}

export interface PriceList {
  iphones: Iphone[];
  /** Null when the calculator could not be read or does not reproduce the page's own examples. */
  tradeIn: TradeIn | null;
}

const RowSchema = z.tuple([
  z.string().min(1),
  z.string().min(1),
  z.number().positive(),
  z.array(z.tuple([z.number().int().min(1).max(100), z.string().min(1), z.number().positive()])),
]);
const DataSchema = z.array(RowSchema).min(1);
const ValuesSchema = z.record(z.string(), z.number().positive());
const PhotosSchema = z.record(z.string(), z.string());
const ExamplesSchema = z.array(z.tuple([z.string(), z.string(), z.number()])).min(1);

/** Returns the bracketed literal assigned to `const <name>=`, or undefined when the script has none. */
function literalOf(script: string, name: string): string | undefined {
  const declared = new RegExp(`const\\s+${name}\\s*=\\s*`).exec(script);
  if (declared === null) {
    return undefined;
  }
  const start = declared.index + declared[0].length;
  const open = script[start];
  if (open !== '[' && open !== '{') {
    return undefined;
  }
  let depth = 0;
  let quote: string | null = null;
  for (let i = start; i < script.length; i++) {
    const char = script[i] as string;
    if (quote !== null) {
      if (char === '\\') {
        i++;
      } else if (char === quote) {
        quote = null;
      }
    } else if (char === "'" || char === '"') {
      quote = char;
    } else if (char === '[' || char === '{') {
      depth++;
    } else if (char === ']' || char === '}') {
      depth--;
      if (depth === 0) {
        return script.slice(start, i + 1);
      }
    }
  }
  return undefined;
}

/** Turns a JavaScript literal of strings, numbers, arrays and quoted-key objects into JSON. */
function parseLiteral(literal: string): unknown {
  const json = literal
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/'((?:[^'\\]|\\.)*)'/g, (_match, inner: string) => JSON.stringify(inner.replace(/\\'/g, "'")))
    .replace(/,(\s*[\]}])/g, '$1');
  return JSON.parse(json);
}

function storageGb(text: string): number {
  const match = /^(\d+)\s*(GB|TB)$/i.exec(text.trim());
  if (match === null) {
    throw new Error(`Unreadable capacity "${text}"`);
  }
  return Number(match[1]) * (match[2]?.toUpperCase() === 'TB' ? 1024 : 1);
}

const SEALED = /\s*sellado\s*$/i;

function toIphone([model, storage, from, variants]: z.infer<typeof RowSchema>, photos: Record<string, string>): Iphone {
  const condition: IphoneCondition = SEALED.test(model) ? 'new' : 'used';
  const bare = model.replace(SEALED, '').trim();
  const gb = storageGb(storage);
  const units = variants.map(([battery_pct, color, price_usd]) => ({ battery_pct, color, price_usd, image_url: null }));
  return {
    id: `iphone-${normalise(bare).replace(/\s+/g, '-')}-${gb >= 1024 ? `${gb / 1024}tb` : `${gb}gb`}-${condition}`,
    name: `iPhone ${bare}`,
    model: bare,
    condition,
    storage_gb: gb,
    from_price_usd: from,
    price_usd: units.length === 0 ? from : Math.min(...units.map((u) => u.price_usd)),
    units,
    image_url: photos[model] ?? null,
  };
}

const isSealed18 = (model: string): boolean => model.startsWith('18 ');

/** The difference the page's calculator shows: target value minus delivered value plus the margin of the target. */
export const tradeInDifference = (tradeIn: TradeIn, have: string, want: string): number =>
  (tradeIn.values[want] as number) - (tradeIn.values[have] as number) + (isSealed18(want) ? tradeIn.sealed18Margin : tradeIn.margin);

function readTradeIn(script: string): TradeIn | null {
  const valuesLiteral = literalOf(script, 'CANJE_VALORES');
  const margins = /const\s+margin\s*=\s*sellado18\s*\?\s*(\d+)\s*:\s*(\d+)/.exec(script);
  const examplesLiteral = literalOf(script, 'tests');
  if (valuesLiteral === undefined || margins === null || examplesLiteral === undefined) {
    return null;
  }
  try {
    const tradeIn: TradeIn = {
      values: ValuesSchema.parse(parseLiteral(valuesLiteral)),
      sealed18Margin: Number(margins[1]),
      margin: Number(margins[2]),
    };
    // The page validates its own formula against a list of worked examples; ours must give the same answers.
    const examples = ExamplesSchema.parse(parseLiteral(examplesLiteral));
    const agrees = examples.every(
      ([have, want, expected]) => have in tradeIn.values && want in tradeIn.values && tradeInDifference(tradeIn, have, want) === expected,
    );
    return agrees ? tradeIn : null;
  } catch {
    return null;
  }
}

/** The page's picture per model, as full URLs; empty when the page has none or they are unreadable (pictures are optional). */
function readPhotos(script: string): Record<string, string> {
  const base = /const\s+base\s*=\s*'([^']+)'/.exec(script)?.[1];
  const literal = literalOf(script, 'photos');
  if (base === undefined || literal === undefined) {
    return {};
  }
  try {
    const files = PhotosSchema.parse(parseLiteral(literal));
    const urls = Object.entries(files).map(([model, file]) => [model, fullSizeImage(base + file)] as const);
    return Object.fromEntries(urls.filter((entry): entry is readonly [string, string] => entry[1] !== null));
  } catch {
    return {};
  }
}

export function parsePriceList(html: string): PriceList {
  const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1] as string);
  const script = scripts.find((s) => s.includes('mobik-catalog') && /const\s+data\s*=/.test(s));
  if (script === undefined) {
    throw new Error('Price list page has no catalog script');
  }
  const dataLiteral = literalOf(script, 'data');
  if (dataLiteral === undefined) {
    throw new Error('Price list script has no data literal');
  }
  const iphones = DataSchema.parse(parseLiteral(dataLiteral)).map((row) => toIphone(row, readPhotos(script)));
  if (new Set(iphones.map((p) => p.id)).size !== iphones.length) {
    throw new Error('Price list repeats a model, capacity and condition');
  }
  return { iphones, tradeIn: readTradeIn(script) };
}

export type TradeInQuote =
  | { ok: true; have: string; want: string; difference_usd: number }
  | { ok: false; reason: 'unknown_have' | 'unknown_want' | 'not_higher_value'; accepted: string[]; offered: string[] };

const modelKey = (text: string): string =>
  normalise(text)
    .replace(/\b(apple|iphone|sellado|nuevo|usado)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** Quotes the difference to pay. Only the 13 to 17 lines are taken in part payment, and only towards a model of higher value. */
export function quoteTradeIn(tradeIn: TradeIn, have: string, want: string): TradeInQuote {
  const models = Object.keys(tradeIn.values);
  const accepted = models.filter((m) => !isSealed18(m));
  const display = (m: string): string => `iPhone ${m}`;
  const failure = (reason: 'unknown_have' | 'unknown_want' | 'not_higher_value', offered: string[]): TradeInQuote => ({
    ok: false,
    reason,
    accepted: accepted.map(display),
    offered: offered.map(display),
  });
  const haveModel = accepted.find((m) => modelKey(m) === modelKey(have));
  if (haveModel === undefined) {
    return failure('unknown_have', models);
  }
  const higher = models.filter((m) => (tradeIn.values[m] as number) > (tradeIn.values[haveModel] as number));
  const wantModel = models.find((m) => modelKey(m) === modelKey(want));
  if (wantModel === undefined) {
    return failure('unknown_want', higher);
  }
  if (!higher.includes(wantModel)) {
    return failure('not_higher_value', higher);
  }
  return { ok: true, have: display(haveModel), want: display(wantModel), difference_usd: tradeInDifference(tradeIn, haveModel, wantModel) };
}
