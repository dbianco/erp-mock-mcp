export const CATEGORIES = [
  'bicicletas',
  'motos eléctricas',
  'jardín',
  'dormitorio',
  'electrodomésticos',
  'cuidado personal',
  'sillones y sofás',
] as const;

export type Category = (typeof CATEGORIES)[number];

// The first matching rule wins. No current product name matches two rules; the order only
// breaks the tie if a future name does (a "BICICLETA ... MOTO" would be filed as a bicycle).
const RULES: ReadonlyArray<readonly [RegExp, Category]> = [
  [/\bBICICLETA\b/, 'bicicletas'],
  [/\bMOTO\b/, 'motos eléctricas'],
  [/\bJARDIN\b/, 'jardín'],
  [/\b(TOCADOR|ZAPATERO)\b/, 'dormitorio'],
  [/\b(LAVAVAJILLA|LICUADORA|ROBOT)\b/, 'electrodomésticos'],
  [/\b(CEPILLO|SECADOR)\b/, 'cuidado personal'],
  [/\b(BUTACA|SOFA)\b/, 'sillones y sofás'],
];

export function categoryFor(name: string): Category {
  const upper = name.toUpperCase();
  for (const [pattern, category] of RULES) {
    if (pattern.test(upper)) {
      return category;
    }
  }
  throw new Error(`No category rule matches "${name}"`);
}
