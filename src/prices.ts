/**
 * Parses one price cell of the source table into integer pesos.
 *
 * The table mixes two formats: the struck-through price is `1.499.007,73` (dots group
 * thousands, the comma starts the decimals) and the other columns are `$1,249,000.00` (the
 * opposite). A leading `$` selects the second reading.
 */
export function parsePrice(raw: string): number | null {
  const text = raw.trim();
  if (text === '') {
    return null;
  }
  const normalised = text.startsWith('$')
    ? text.slice(1).replace(/,/g, '')
    : text.replace(/\./g, '').replace(',', '.');
  const value = Number(normalised);
  if (normalised === '' || !Number.isFinite(value) || value < 0) {
    throw new Error(`Unparseable price: "${raw}"`);
  }
  return Math.round(value);
}
