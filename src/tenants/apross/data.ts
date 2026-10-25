import { z } from 'zod';
import { dataFile, loadJson } from '../../data.js';
import { normalise } from '../../text.js';

const TENANT = 'apross';

export const PersonSchema = z.object({ name: z.string(), role: z.string() });
const AuthoritiesSchema = z.object({
  source_url: z.string().url(),
  read_at: z.string(),
  board: z.array(PersonSchema).min(1),
  directors: z.array(PersonSchema),
  about: z.array(z.string()),
});

export const ProgramSchema = z.object({
  slug: z.string(),
  name: z.string(),
  summary: z.string(),
  /** Null when the site does not say who is eligible: the tool must say "not published", never guess. */
  who: z.string().nullable(),
  benefits: z.array(z.string()),
  how_to: z.array(z.string()),
  providers: z.array(z.object({ name: z.string(), phone: z.string().nullable() })),
  notes: z.array(z.string()),
  source_url: z.string().url(),
});
export type Program = z.infer<typeof ProgramSchema>;
const ProgramsSchema = z.object({ read_at: z.string(), programs: z.array(ProgramSchema).min(1) });

export const OfficeKindSchema = z.enum(['delegacion', 'subdelegacion', 'puesto']);
export const OfficeSchema = z.object({
  kind: OfficeKindSchema,
  name: z.string(),
  locality: z.string(),
  address: z.string(),
  hours: z.string(),
  phone: z.string().nullable(),
});
export type Office = z.infer<typeof OfficeSchema>;
const OfficesSchema = z.object({ source_url: z.string().url(), read_at: z.string(), offices: z.array(OfficeSchema).min(1) });

export const ContactSchema = z.object({ purpose: z.string(), value: z.string(), hours: z.string().nullable() });
const ContactsSchema = z.object({ source_url: z.string().url(), read_at: z.string(), contacts: z.array(ContactSchema).min(1) });

const SourceTypeSchema = z.enum(['apross', 'press']);
export const MammographySchema = z.object({
  read_at: z.string(),
  summary: z.string(),
  requirements: z.array(z.string()),
  cost: z.string(),
  affiliate_benefit: z.object({
    valid_until: z.string(),
    requirements: z.array(z.string()),
    free_services: z.array(z.string()),
    how_to_get_appointment: z.string(),
  }),
  latest_stop: z.object({ place: z.string(), schedule: z.string(), also_there: z.array(z.string()) }),
  figures: z.array(z.object({ claim: z.string(), as_of: z.string(), source_url: z.string().url(), source_type: SourceTypeSchema })),
  notes: z.array(z.string()),
  sources: z.array(z.object({ title: z.string(), url: z.string().url(), source_type: SourceTypeSchema })).min(1),
});

export const loadAuthorities = () => loadJson(AuthoritiesSchema, dataFile(TENANT, 'authorities.json'));
export const loadPrograms = () => loadJson(ProgramsSchema, dataFile(TENANT, 'programs.json'));
export const loadOffices = () => loadJson(OfficesSchema, dataFile(TENANT, 'offices.json'));
export const loadContacts = () => loadJson(ContactsSchema, dataFile(TENANT, 'contacts.json'));
export const loadMammography = () => loadJson(MammographySchema, dataFile(TENANT, 'mammography.json'));

/** Matches a program by slug or by a name containing the input, ignoring case and accents. */
export function resolveProgram(programs: readonly Program[], input: string): Program | undefined {
  const wanted = normalise(input.trim());
  if (wanted === '') {
    return undefined;
  }
  return (
    programs.find((p) => p.slug === wanted || normalise(p.name) === wanted) ??
    programs.find((p) => normalise(p.name).includes(wanted) || normalise(p.slug).includes(wanted))
  );
}

/** Offices whose locality, name or address contains the query (accent- and case-insensitive), optionally of one kind. */
export function findOffices(offices: readonly Office[], query: string | undefined, kind: Office['kind'] | undefined): Office[] {
  const wanted = normalise((query ?? '').trim());
  return offices.filter(
    (o) =>
      (kind === undefined || o.kind === kind) &&
      (wanted === '' || [o.locality, o.name, o.address].some((field) => normalise(field).includes(wanted))),
  );
}
