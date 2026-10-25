import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, test } from 'vitest';
import { createAprossTenant } from './index.js';
import { loadOffices, loadPrograms } from './data.js';

interface ToolResult {
  isError?: boolean;
  content: { type: string; text: string }[];
  structuredContent?: Record<string, any>;
}

async function connect(): Promise<Client> {
  const server = createAprossTenant().createServer();
  const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '1' });
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
  return client;
}
const call = async (client: Client, name: string, args: Record<string, unknown> = {}) =>
  (await client.callTool({ name, arguments: args })) as ToolResult;

describe('APROSS authorities', () => {
  test('names the president and both directores generales', async () => {
    const { structuredContent, content } = await call(await connect(), 'get_authorities');
    expect(structuredContent?.board[0]).toEqual({ name: 'Dr. Pablo Venturuzzi', role: 'Presidente del Directorio' });
    expect(structuredContent?.board).toHaveLength(5);
    expect(structuredContent?.directors.map((d: { name: string }) => d.name)).toEqual(['Ctdor. Lucas Valdemarin', 'Facundo Barrabino']);
    expect(content[0]?.text).toContain('Cecilia Muñoz de Toro');
  });
});

describe('APROSS health programs', () => {
  test('lists the three programs the website lists', async () => {
    const { programs } = (await call(await connect(), 'list_health_programs')).structuredContent as { programs: { slug: string }[] };
    expect(programs.map((p) => p.slug)).toEqual(['plan-materno-infantil', 'calendario-nacional-vacunacion', 'prevencion-control-obesidad']);
  });

  test('resolves a program by part of its name, ignoring accents and case', async () => {
    const result = await call(await connect(), 'get_health_program', { program: 'OBESIDAD' });
    expect(result.structuredContent?.program.slug).toBe('prevencion-control-obesidad');
    expect(result.content[0]?.text).toContain('IMC desde 27');
  });

  test('says the website does not publish eligibility instead of inventing it', async () => {
    const result = await call(await connect(), 'get_health_program', { program: 'plan-materno-infantil' });
    expect(result.structuredContent?.program.who).toBeNull();
    expect(result.content[0]?.text).toContain('el sitio no lo publica');
    expect(result.content[0]?.text).toContain('integral@apross.gov.ar');
  });

  test('an unknown program is an error that lists the valid ones', async () => {
    const result = await call(await connect(), 'get_health_program', { program: 'ortodoncia' });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('Plan Materno Infantil');
  });

  test('every program cites an apross.gov.ar page', () => {
    for (const p of loadPrograms().programs) {
      expect(p.source_url).toMatch(/^https:\/\/www\.apross\.gov\.ar\//);
    }
  });
});

describe('APROSS mobile mammography', () => {
  test('gives requirements, cost and the affiliate benefit end date', async () => {
    const { structuredContent, content } = await call(await connect(), 'get_mobile_mammography');
    expect(structuredContent?.requirements.join(' ')).toContain('12 meses');
    expect(structuredContent?.affiliate_benefit.valid_until).toBe('2026-10-31');
    expect(content[0]?.text).toContain('Sin costo');
  });

  test('every figure says its date and whether APROSS or the press is the source', async () => {
    const { figures } = (await call(await connect(), 'get_mobile_mammography')).structuredContent as {
      figures: { as_of: string; source_type: string }[];
    };
    expect(figures.length).toBeGreaterThan(1);
    expect(new Set(figures.map((f) => f.source_type))).toEqual(new Set(['apross', 'press']));
    for (const f of figures) {
      expect(f.as_of).toMatch(/^\d{4}-\d{2}/);
    }
  });
});

describe('APROSS offices', () => {
  test('the dataset has the 28 + 9 + 21 offices the website lists', () => {
    const counts = { delegacion: 0, subdelegacion: 0, puesto: 0 };
    for (const o of loadOffices().offices) {
      counts[o.kind]++;
    }
    expect(counts).toEqual({ delegacion: 28, subdelegacion: 9, puesto: 21 });
  });

  test('finds by locality ignoring accents', async () => {
    const { offices } = (await call(await connect(), 'find_offices', { query: 'rio cuarto' })).structuredContent as { offices: { name: string }[] };
    expect(offices.map((o) => o.name)).toEqual(['Río Cuarto (Centro Cívico)', 'Clínica Regional del Sud']);
  });

  test('kind narrows the result', async () => {
    const { offices } = (await call(await connect(), 'find_offices', { query: 'Córdoba Capital', kind: 'delegacion' })).structuredContent as {
      offices: { kind: string }[];
    };
    expect(offices).toHaveLength(2);
    expect(offices.every((o) => o.kind === 'delegacion')).toBe(true);
  });

  test('a subdelegation with no landline reports no published phone', async () => {
    const result = await call(await connect(), 'find_offices', { query: 'La Carlota' });
    expect(result.structuredContent?.offices[0].phone).toBeNull();
    expect(result.content[0]?.text).toContain('sin teléfono publicado');
  });

  test('no match is a normal answer, not an error', async () => {
    const result = await call(await connect(), 'find_offices', { query: 'Ushuaia' });
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent?.offices).toEqual([]);
  });
});

describe('APROSS contacts and business info', () => {
  test('get_contacts includes the call centre and the treatments e-mail', async () => {
    const text = (await call(await connect(), 'get_contacts')).content[0]?.text ?? '';
    expect(text).toContain('0-800-888-2776');
    expect(text).toContain('integral@apross.gov.ar');
  });

  test('the Sede Central is open Monday 10:00 and closed at 14:00 and on Saturday', async () => {
    const client = await connect();
    const open = async (at: string) => (await call(client, 'get_business_info', { at })).structuredContent?.open_now;
    expect(await open('2026-10-26T10:00:00')).toBe(true);
    expect(await open('2026-10-26T14:00:00')).toBe(false);
    expect(await open('2026-10-24T10:00:00')).toBe(false);
  });
});
