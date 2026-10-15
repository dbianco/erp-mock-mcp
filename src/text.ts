/** Lower-cases and strips diacritics so "ELÉCTRICA" and "electrica" compare equal. */
export function normalise(text: string): string {
  return text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
}

/**
 * Splits a query into lower-cased, accent-free words. Punctuation at the edges of a word is
 * dropped ("¿bicicletas?" -> "bicicletas") but punctuation inside it is kept, because product
 * names contain it ("GA.MA", "2,06M").
 */
export function tokenise(text: string): string[] {
  return normalise(text)
    .split(/\s+/)
    .map((token) => token.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ''))
    .filter((token) => token !== '');
}
