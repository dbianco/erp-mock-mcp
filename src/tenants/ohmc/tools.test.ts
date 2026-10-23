import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, test } from 'vitest';
import { createOhmcTenant } from './index.js';
import { DISCLAIMER } from './weather.js';

interface ToolResult {
  isError?: boolean;
  content: { type: string; text: string }[];
  structuredContent?: Record<string, any>;
}

async function connect(): Promise<Client> {
  const server = createOhmcTenant().createServer();
  const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '1' });
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
  return client;
}
const call = async (client: Client, name: string, args: Record<string, unknown> = {}) =>
  (await client.callTool({ name, arguments: args })) as ToolResult;

describe('OHMC forecast tools', () => {
  test('offers list_localities and get_forecast', async () => {
    const { tools } = await (await connect()).listTools();
    expect(tools.map((t) => t.name)).toEqual(expect.arrayContaining(['get_forecast', 'list_localities']));
  });

  test('list_localities names the four required localities', async () => {
    const { localities } = (await call(await connect(), 'list_localities')).structuredContent as {
      localities: { name: string }[];
    };
    expect(localities.map((l) => l.name)).toEqual(
      expect.arrayContaining(['Córdoba', 'Villa Carlos Paz', 'Río Cuarto', 'Villa María']),
    );
  });

  test('get_forecast defaults to today: one day dated 2026-10-23', async () => {
    const { structuredContent } = await call(await connect(), 'get_forecast', { locality: 'Córdoba' });
    expect(structuredContent).toMatchObject({ locality: 'Córdoba', reference_date: '2026-10-23', extended: false });
    expect(structuredContent?.days).toHaveLength(1);
    expect(structuredContent?.days[0].date).toBe('2026-10-23');
  });

  test('extended returns five days', async () => {
    const { structuredContent } = await call(await connect(), 'get_forecast', { locality: ' río cuarto ', extended: true });
    expect(structuredContent?.extended).toBe(true);
    expect(structuredContent?.days).toHaveLength(5);
  });

  test('every answer carries the disclaimer in text and structured content', async () => {
    const client = await connect();
    for (const [name, args] of [
      ['get_forecast', { locality: 'Córdoba' }],
      ['get_forecast', { locality: 'Córdoba', extended: true }],
    ] as const) {
      const result = await call(client, name, args);
      expect(result.content[0]?.text).toContain(DISCLAIMER);
      expect(result.structuredContent?.disclaimer).toBe(DISCLAIMER);
    }
  });

  test('an unknown locality is an isError result that lists the valid ones', async () => {
    const result = await call(await connect(), 'get_forecast', { locality: 'Atlantis' });
    expect(result.isError).toBe(true);
    for (const name of ['Córdoba', 'Villa Carlos Paz', 'Río Cuarto', 'Villa María']) {
      expect(result.content[0]?.text).toContain(name);
    }
  });
});

describe('OHMC full tool set', () => {
  test('offers exactly the seven tools', async () => {
    const { tools } = await (await connect()).listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      'get_active_alerts',
      'get_business_info',
      'get_current_conditions',
      'get_forecast',
      'get_hydrological_levels',
      'get_monitoring_links',
      'list_localities',
    ]);
  });

  test('alerts with no locality return all of them, between one and two', async () => {
    const { alerts } = (await call(await connect(), 'get_active_alerts')).structuredContent as { alerts: any[] };
    expect(alerts.length).toBeGreaterThanOrEqual(1);
    expect(alerts.length).toBeLessThanOrEqual(2);
    for (const alert of alerts) {
      expect(['amarillo', 'naranja', 'rojo']).toContain(alert.level);
      expect(alert.recommended_action.length).toBeGreaterThan(0);
    }
  });

  test('an alert for Villa Carlos Paz is returned for it and not for Río Cuarto', async () => {
    const client = await connect();
    const carlosPaz = (await call(client, 'get_active_alerts', { locality: 'Villa Carlos Paz' })).structuredContent!;
    expect(carlosPaz.alerts.length).toBeGreaterThanOrEqual(1);
    const rioCuarto = (await call(client, 'get_active_alerts', { locality: 'Río Cuarto' })).structuredContent!;
    expect(rioCuarto.alerts).toEqual([]);
  });

  test('a locality with no alert is a normal answer that still carries the disclaimer', async () => {
    const result = await call(await connect(), 'get_active_alerts', { locality: 'Río Cuarto' });
    expect(result.isError).toBeUndefined();
    expect(result.content[0]?.text).toContain('0 active alerts');
    expect(result.content[0]?.text).toContain(DISCLAIMER);
    expect(result.structuredContent?.disclaimer).toBe(DISCLAIMER);
  });

  test.each([
    ['get_active_alerts', { locality: 'Atlantis' }],
    ['get_current_conditions', { locality: 'Atlantis' }],
    ['get_hydrological_levels', { locality: 'Atlantis' }],
  ])('%s with an unknown locality is an isError result', async (name, args) => {
    const result = await call(await connect(), name, args);
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('Villa María');
  });

  test('current conditions are a fixed observation with the disclaimer', async () => {
    const result = await call(await connect(), 'get_current_conditions', { locality: 'cordoba' });
    expect(result.structuredContent).toMatchObject({ locality: 'Córdoba', disclaimer: DISCLAIMER });
    expect(typeof result.structuredContent?.observed_at).toBe('string');
    expect(result.structuredContent?.humidity_percent).toBeGreaterThanOrEqual(0);
    expect(result.content[0]?.text).toContain(DISCLAIMER);
  });

  test('hydrology without a locality returns at least one river and one dam', async () => {
    const { stations } = (await call(await connect(), 'get_hydrological_levels')).structuredContent as { stations: any[] };
    expect(stations.some((s) => s.kind === 'river')).toBe(true);
    expect(stations.some((s) => s.kind === 'dam')).toBe(true);
  });

  test('hydrology narrows to a locality', async () => {
    const all = (await call(await connect(), 'get_hydrological_levels')).structuredContent!.stations as any[];
    const some = (await call(await connect(), 'get_hydrological_levels', { locality: all[0].locality })).structuredContent!
      .stations as any[];
    expect(some.length).toBeGreaterThanOrEqual(1);
    expect(some.every((s) => s.locality === all[0].locality)).toBe(true);
  });

  test("every weather tool's text says the data is not official", async () => {
    const client = await connect();
    for (const [name, args] of [
      ['list_localities', {}],
      ['get_forecast', { locality: 'Córdoba' }],
      ['get_active_alerts', {}],
      ['get_current_conditions', { locality: 'Córdoba' }],
      ['get_hydrological_levels', {}],
    ] as const) {
      expect((await call(client, name, args)).content[0]?.text, name).toContain('no oficiales');
    }
  });

  test('business info has the real address and e-mail and no open/closed answer', async () => {
    const result = await call(await connect(), 'get_business_info', { at: '2026-10-23T10:00:00' });
    expect(result.structuredContent).toMatchObject({
      address: 'Ituzaingó 1300, Parque de las Tejas, Córdoba',
      email: 'info@ohmc.ar',
      hours: null,
      open_now: null,
    });
    expect(Object.keys(result.structuredContent?.links)).toEqual(expect.arrayContaining(['facebook', 'x', 'instagram', 'youtube']));
    expect(result.structuredContent?.notes.join(' ')).toContain('COSECHEROS');
  });

  test('monitoring links all use https', async () => {
    const { links } = (await call(await connect(), 'get_monitoring_links')).structuredContent as {
      links: { name: string; url: string; description: string }[];
    };
    expect(links.length).toBeGreaterThanOrEqual(5);
    for (const link of links) {
      expect(link.url.startsWith('https://')).toBe(true);
    }
  });
});
