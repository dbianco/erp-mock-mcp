import { z } from 'zod';
import { normalise, tokenise } from '../../text.js';

/** Reads the question-and-answer blocks (`<details><summary>`) of the store's FAQ and shipping-policy pages. */

export const FAQ_SOURCES = ['faq', 'shipping_policy'] as const;
export type FaqSource = (typeof FAQ_SOURCES)[number];

export const FaqEntrySchema = z.object({
  source: z.enum(FAQ_SOURCES),
  question: z.string().min(1),
  answer: z.string().min(1),
  source_url: z.string(),
});
export type FaqEntry = z.infer<typeof FaqEntrySchema>;

/**
 * Warranty and payment methods have their own tools, fed by the owner, and the site's pages contradict them (the
 * shipping policy gives sealed phones 30 days; the FAQ lists debit cards and Mercado Pago). Those entries are left out
 * so the agent never has two answers to the same question.
 */
const ANSWERED_ELSEWHERE = /garantia|formas? de pago|medios? de pago/;

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', nbsp: ' ', '#39': "'", '#039': "'", '#8217': "'", '#8220': '"', '#8221': '"', '#8211': '-' };
const plainText = (html: string): string =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(#?\w+);/g, (match, name: string) => ENTITIES[name] ?? match)
    .replace(/\s+/g, ' ')
    .trim();

export function parseFaqPage(html: string, source: FaqSource, sourceUrl: string): FaqEntry[] {
  const blocks = [...html.matchAll(/<details\b[^>]*>\s*<summary\b[^>]*>([\s\S]*?)<\/summary>([\s\S]*?)<\/details>/gi)];
  const entries = blocks
    .map((block) => ({
      source,
      question: plainText(block[1] as string).replace(/^\d+\.\s*/, ''),
      answer: plainText(block[2] as string),
      source_url: sourceUrl,
    }))
    .filter((entry) => entry.question !== '' && entry.answer !== '');
  if (entries.length === 0) {
    throw new Error(`${sourceUrl} has no question-and-answer blocks`);
  }
  return entries.filter((entry) => !ANSWERED_ELSEWHERE.test(normalise(entry.question)));
}

/** Entries that contain every word of the query, in the question or the answer; all of them when there is no query. */
export function searchFaq(entries: readonly FaqEntry[], query: string | undefined): FaqEntry[] {
  const tokens = tokenise(query ?? '');
  return entries.filter((entry) => {
    const text = normalise(`${entry.question} ${entry.answer}`);
    return tokens.every((token) => text.includes(token));
  });
}
