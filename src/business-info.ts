import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { dataFile, loadJson } from './data.js';

export const BUSINESS_TIME_ZONE = 'America/Argentina/Cordoba';

const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
export type DayKey = (typeof DAYS)[number];

const Time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

export const BusinessInfoSchema = z.object({
  name: z.string(),
  address: z.string(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  /** Exactly seven entries, or null when the business publishes no hours. Empty `ranges` means closed. */
  hours: z.array(z.object({ day: z.enum(DAYS), ranges: z.array(z.object({ open: Time, close: Time })) })).length(7).nullable(),
  links: z.record(z.string(), z.string()),
  notes: z.array(z.string()),
});

export type BusinessInfo = z.infer<typeof BusinessInfoSchema>;

export const loadBusinessInfo = (tenant: string): BusinessInfo =>
  loadJson(BusinessInfoSchema, dataFile(tenant, 'business.json'));

const FORMAT_HINT = 'Use an ISO 8601 date-time such as 2026-10-23T10:00:00 (Córdoba time when no offset is given).';

/** False for a day the calendar does not have (2026-02-30), which `Date` would silently roll over. */
const isRealDay = (year: number, month: number, day: number): boolean => {
  const check = new Date(Date.UTC(year, month - 1, day));
  return check.getUTCFullYear() === year && check.getUTCMonth() === month - 1 && check.getUTCDate() === day;
};

/** Parses an ISO 8601 date-time; one with no UTC offset is Córdoba local time (UTC-3, no daylight saving). */
export function parseAt(at: string): Date {
  const hasOffset = /(Z|[+-]\d{2}(:?\d{2})?)$/i.test(at.trim());
  const date = new Date(hasOffset ? at.trim() : `${at.trim()}-03:00`);
  const typed = /^(\d{4})-(\d{2})-(\d{2})T\d{2}:\d{2}/.exec(at.trim());
  if (typed === null || Number.isNaN(date.getTime()) || !isRealDay(Number(typed[1]), Number(typed[2]), Number(typed[3]))) {
    throw new Error(`Cannot read "${at}" as a date-time. ${FORMAT_HINT}`);
  }
  return date;
}

const clock = new Intl.DateTimeFormat('en-GB', {
  timeZone: BUSINESS_TIME_ZONE,
  weekday: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

const minutes = (time: string): number => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));

/** True inside a range `[open, close)`; null when the business publishes no hours. */
export function isOpenAt(info: BusinessInfo, at: Date): boolean | null {
  if (info.hours === null) {
    return null;
  }
  const parts = Object.fromEntries(clock.formatToParts(at).map((p) => [p.type, p.value]));
  const day = String(parts.weekday).toLowerCase().slice(0, 3);
  const now = Number(parts.hour) * 60 + Number(parts.minute);
  const today = info.hours.find((h) => h.day === day);
  return (today?.ranges ?? []).some((r) => minutes(r.open) <= now && now < minutes(r.close));
}

const describeHours = (info: BusinessInfo): string[] =>
  info.hours === null
    ? ['hours: not published']
    : info.hours.map((h) => `${h.day} ${h.ranges.length === 0 ? 'closed' : h.ranges.map((r) => `${r.open}-${r.close}`).join(', ')}`);

export function registerBusinessInfoTool(server: McpServer, info: BusinessInfo): void {
  server.registerTool(
    'get_business_info',
    {
      title: 'Business information',
      description:
        'Contact details of the business: address, phone, e-mail, web and social links, weekly opening hours and notes. ' +
        'Pass `at` (ISO 8601 date-time, Córdoba time when no offset) to also learn whether it is open at that moment; ' +
        'without `at` the open/closed answer is not given. If a field is null the business has not published it: say so, never invent it.',
      inputSchema: { at: z.string().max(40).optional() },
      outputSchema: {
        name: z.string(),
        address: z.string(),
        phone: z.string().nullable(),
        email: z.string().nullable(),
        hours: BusinessInfoSchema.shape.hours,
        links: z.record(z.string(), z.string()),
        notes: z.array(z.string()),
        open_now: z.boolean().nullable(),
        checked_at: z.string().nullable(),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ at }) => {
      let openNow: boolean | null = null;
      if (at !== undefined) {
        try {
          openNow = isOpenAt(info, parseAt(at));
        } catch (error) {
          return { isError: true as const, content: [{ type: 'text' as const, text: (error as Error).message }] };
        }
      }
      const text = [
        info.name,
        `address: ${info.address}`,
        `phone: ${info.phone ?? 'not published'}`,
        ...(info.email === null ? [] : [`email: ${info.email}`]),
        ...describeHours(info),
        ...Object.entries(info.links).map(([name, url]) => `${name}: ${url}`),
        ...info.notes,
        ...(at === undefined ? [] : [openNow === null ? `open at ${at}: unknown (hours not published)` : `open at ${at}: ${openNow ? 'yes' : 'no'}`]),
      ].join('\n');
      return {
        content: [{ type: 'text' as const, text }],
        structuredContent: { ...info, open_now: openNow, checked_at: at ?? null },
      };
    },
  );
}
