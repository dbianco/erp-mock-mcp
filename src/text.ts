/** Lower-cases and strips diacritics so "ELÉCTRICA" and "electrica" compare equal. */
export function normalise(text: string): string {
  return text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
}

export function tokenise(text: string): string[] {
  return normalise(text)
    .split(/\s+/)
    .filter((token) => token !== '');
}
