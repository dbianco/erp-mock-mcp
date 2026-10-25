import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  ContactSchema,
  MammographySchema,
  OfficeKindSchema,
  OfficeSchema,
  PersonSchema,
  ProgramSchema,
  findOffices,
  loadAuthorities,
  loadContacts,
  loadMammography,
  loadOffices,
  loadPrograms,
  resolveProgram,
} from './data.js';

const text = (value: string) => [{ type: 'text' as const, text: value }];
const failure = (message: string) => ({ isError: true as const, content: text(message) });

/** Said in every answer: this is a snapshot of the website, not a live lookup. */
export const SNAPSHOT_NOTE = 'Información tomada del sitio de APROSS (apross.gov.ar) y leída el 2026-10-25; puede haber cambiado';

export function registerAprossTools(server: McpServer): void {
  const authorities = loadAuthorities();
  const programs = loadPrograms();
  const offices = loadOffices();
  const contacts = loadContacts();
  const mammography = loadMammography();

  server.registerTool(
    'get_authorities',
    {
      title: 'APROSS authorities',
      description:
        'Authorities of APROSS (Administración Provincial del Seguro de Salud de Córdoba): the Directorio (president, vice-president, vocales) ' +
        'and the directores generales, plus what the institution is. Names and titles are copied from the website. ' +
        `${SNAPSHOT_NOTE}: say so if asked how current it is.`,
      inputSchema: {},
      outputSchema: {
        board: z.array(PersonSchema),
        directors: z.array(PersonSchema),
        about: z.array(z.string()),
        source_url: z.string(),
        read_at: z.string(),
      },
      annotations: { readOnlyHint: true },
    },
    async () => ({
      content: text(
        [
          'Directorio:',
          ...authorities.board.map((p) => `- ${p.role}: ${p.name}`),
          'Direcciones generales:',
          ...authorities.directors.map((p) => `- ${p.role}: ${p.name}`),
          ...authorities.about,
          `Fuente: ${authorities.source_url} (leída ${authorities.read_at})`,
        ].join('\n'),
      ),
      structuredContent: { ...authorities },
    }),
  );

  server.registerTool(
    'list_health_programs',
    {
      title: 'List health programs',
      description:
        'List the health programs listed on the APROSS website (Programas de Salud) with a one-line summary. ' +
        'Use get_health_program for the detail of one.',
      inputSchema: {},
      outputSchema: { programs: z.array(z.object({ slug: z.string(), name: z.string(), summary: z.string(), source_url: z.string() })), read_at: z.string() },
      annotations: { readOnlyHint: true },
    },
    async () => {
      const list = programs.programs.map(({ slug, name, summary, source_url }) => ({ slug, name, summary, source_url }));
      return {
        content: text(list.map((p) => `${p.name} (${p.slug}): ${p.summary}`).join('\n')),
        structuredContent: { programs: list, read_at: programs.read_at },
      };
    },
  );

  server.registerTool(
    'get_health_program',
    {
      title: 'Health program detail',
      description:
        'Detail of one APROSS health program: who it is for, what it covers, how to start, participating providers and notes. ' +
        'Accepts the slug or part of the name. A null `who` means the website does not say who is eligible: say so, do not guess. ' +
        'Use list_health_programs for valid names.',
      inputSchema: { program: z.string().min(1).max(100) },
      outputSchema: { program: ProgramSchema, read_at: z.string() },
      annotations: { readOnlyHint: true },
    },
    async ({ program }) => {
      const found = resolveProgram(programs.programs, program);
      if (found === undefined) {
        return failure(`Unknown program "${program}". Valid programs: ${programs.programs.map((p) => p.name).join('; ')}.`);
      }
      const lines = [
        found.name,
        found.summary,
        `Quiénes: ${found.who ?? 'el sitio no lo publica'}`,
        ...(found.benefits.length > 0 ? ['Cubre:', ...found.benefits.map((b) => `- ${b}`)] : []),
        ...(found.how_to.length > 0 ? ['Cómo acceder:', ...found.how_to.map((s, i) => `${i + 1}. ${s}`)] : []),
        ...(found.providers.length > 0 ? ['Prestadores:', ...found.providers.map((p) => `- ${p.name}${p.phone === null ? '' : `: ${p.phone}`}`)] : []),
        ...found.notes,
        `Fuente: ${found.source_url} (leída ${programs.read_at})`,
      ];
      return { content: text(lines.join('\n')), structuredContent: { program: found, read_at: programs.read_at } };
    },
  );

  server.registerTool(
    'get_mobile_mammography',
    {
      title: 'Mobile mammography (APROSS + Cerca)',
      description:
        'The APROSS mobile mammography unit (mamógrafo móvil, programa APROSS + Cerca / Córdoba Rosa): requirements, cost, ' +
        'the benefit for affiliates and its end date, the latest stop and figures. Each figure carries its date and whether the source is ' +
        'APROSS itself ("apross") or the press ("press"): say which when quoting one, and note that figures from different dates differ. ' +
        'The route changes; for the current stop tell the user to check apross.gov.ar.',
      inputSchema: {},
      outputSchema: MammographySchema.shape,
      annotations: { readOnlyHint: true },
    },
    async () => ({
      content: text(
        [
          mammography.summary,
          'Requisitos:',
          ...mammography.requirements.map((r) => `- ${r}`),
          `Costo: ${mammography.cost}`,
          `Beneficio para afiliadas (hasta ${mammography.affiliate_benefit.valid_until}): ${mammography.affiliate_benefit.free_services.join('; ')}. ` +
            `Requisitos: ${mammography.affiliate_benefit.requirements.join('; ')}. Turno: ${mammography.affiliate_benefit.how_to_get_appointment}`,
          `Última parada leída: ${mammography.latest_stop.place}, ${mammography.latest_stop.schedule}.`,
          'Cifras:',
          ...mammography.figures.map((f) => `- ${f.claim} (a ${f.as_of}, fuente ${f.source_type}: ${f.source_url})`),
          ...mammography.notes,
          `Leído ${mammography.read_at}.`,
        ].join('\n'),
      ),
      structuredContent: { ...mammography },
    }),
  );

  server.registerTool(
    'find_offices',
    {
      title: 'Find APROSS offices',
      description:
        'Find APROSS delegations, subdelegations and attention desks in partner clinics (puestos de atención) with address, hours and phone. ' +
        '`query` matches locality, name or address (e.g. "Río Cuarto"); `kind` narrows to delegacion, subdelegacion or puesto. ' +
        'A null phone means none is published. No match is a normal answer: suggest the Sede Central or 0800-888-2776.',
      inputSchema: { query: z.string().max(100).optional(), kind: OfficeKindSchema.optional() },
      outputSchema: { offices: z.array(OfficeSchema), source_url: z.string(), read_at: z.string() },
      annotations: { readOnlyHint: true },
    },
    async ({ query, kind }) => {
      const found = findOffices(offices.offices, query, kind);
      return {
        content: text(
          found.length === 0
            ? 'No hay sedes que coincidan.'
            : found.map((o) => `${o.name} [${o.kind}], ${o.locality}: ${o.address}; ${o.hours}; ${o.phone ?? 'sin teléfono publicado'}`).join('\n'),
        ),
        structuredContent: { offices: found, source_url: offices.source_url, read_at: offices.read_at },
      };
    },
  );

  server.registerTool(
    'get_contacts',
    {
      title: 'APROSS contacts',
      description:
        'Phone numbers, e-mail addresses and portals of APROSS by purpose: affiliate call centre, emergencies, general queries, ' +
        'treatments and medication, affiliation procedures, self-service.',
      inputSchema: {},
      outputSchema: { contacts: z.array(ContactSchema), source_url: z.string(), read_at: z.string() },
      annotations: { readOnlyHint: true },
    },
    async () => ({
      content: text(contacts.contacts.map((c) => `${c.purpose}: ${c.value}${c.hours === null ? '' : ` (${c.hours})`}`).join('\n')),
      structuredContent: { ...contacts },
    }),
  );
}
