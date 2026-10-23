import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import type { z } from 'zod';

/** Locates `data/<tenant>/<name>` from the repository root, wherever the process starts. */
export function dataFile(tenant: string, name: string): URL {
  return new URL(`../data/${tenant}/${name}`, import.meta.url);
}

/** Reads and validates a JSON data file; the error names the file so a bad dataset is easy to find. */
export function loadJson<T>(schema: z.ZodType<T>, file: URL): T {
  const parsed = schema.safeParse(JSON.parse(readFileSync(file, 'utf8')));
  if (!parsed.success) {
    throw new Error(`Invalid data file ${basename(file.pathname)}: ${parsed.error.message}`);
  }
  return parsed.data;
}
