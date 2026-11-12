import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { parseAccessories } from './accessories.js';
import { createCachedSource } from './cache.js';
import { type MobikOptions, createMobikTenant } from './index.js';
import { parsePriceList, quoteTradeIn, tradeInDifference } from './price-list.js';
import { parseFaqPage, searchFaq } from './faq.js';
import { fullSizeImage, parseGallery, pickColorImage } from './gallery.js';
import { ACCESSORIES_URL, FAQ_URL, type Fetcher, GALLERY_URL, PRICE_LIST_URL, SHIPPING_POLICY_URL, loadSnapshot } from './sources.js';

const fixture = (name: string): string => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const PAGE = fixture('price-list.html');
const STORE = fixture('accessories.json');
const FAQ = fixture('faq.html');
const SHIPPING = fixture('shipping-policy.html');
const GALLERY = fixture('iphone-gallery.json');
const UPLOADS = 'https://mobikiphones.com.ar/wp-content/uploads';

interface ToolResult {
  isError?: boolean;
  content: { type: string; text: string }[];
  structuredContent?: Record<string, any>;
}

/** A store that answers from the fixtures, counts its hits and can be switched off or handed another page. */
function fakeStore() {
  const state = { hits: [] as string[], down: false, page: PAGE, faq: FAQ };
  const fetcher: Fetcher = async (url) => {
    state.hits.push(url);
    if (state.down) {
      return new Response('unavailable', { status: 503 });
    }
    const body = url === PRICE_LIST_URL ? state.page : url === FAQ_URL ? state.faq : url === SHIPPING_POLICY_URL ? SHIPPING : url === GALLERY_URL ? GALLERY : STORE;
    return new Response(body, { status: 200 });
  };
  return { state, fetcher };
}

async function connect(options: MobikOptions): Promise<Client> {
  const server = createMobikTenant(options).createServer();
  const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '1' });
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
  return client;
}
const call = async (client: Client, name: string, args: Record<string, unknown> = {}) =>
  (await client.callTool({ name, arguments: args })) as ToolResult;

describe('Mobik price list parser', () => {
  const list = parsePriceList(PAGE);

  test('reads every listing with its units, and tells sealed from used', () => {
    expect(list.iphones.length).toBe(27);
    const used15Pro = list.iphones.find((p) => p.id === 'iphone-15-pro-128gb-used');
    expect(used15Pro).toMatchObject({ name: 'iPhone 15 Pro', condition: 'used', storage_gb: 128, from_price_usd: 540, price_usd: 555 });
    expect(used15Pro?.units).toEqual([
      { battery_pct: 100, color: 'Negro', price_usd: 580, image_url: null },
      { battery_pct: 98, color: 'Blanco', price_usd: 575, image_url: null },
      { battery_pct: 87, color: 'Gris', price_usd: 560, image_url: null },
      { battery_pct: 84, color: 'Negro', price_usd: 555, image_url: null },
    ]);
    expect(used15Pro?.image_url).toBe(`${UPLOADS}/2026/11/15-pro-y-15-pro-max.jpeg`);
    expect(list.iphones.every((p) => p.image_url !== null)).toBe(true);
    const sealed = list.iphones.filter((p) => p.condition === 'new');
    expect(sealed.length).toBe(7);
    expect(sealed.every((p) => p.units.length === 0 && p.price_usd === p.from_price_usd)).toBe(true);
    expect(list.iphones.find((p) => p.id === 'iphone-18-pro-max-512gb-new')?.price_usd).toBe(1750);
  });

  test('the sealed and the used iPhone 17 of the same capacity are two listings', () => {
    expect(list.iphones.filter((p) => p.name === 'iPhone 17' && p.storage_gb === 256).map((p) => p.condition).sort()).toEqual(['new', 'used']);
  });

  test("the trade-in formula reproduces the page's own worked examples", () => {
    expect(list.tradeIn).not.toBeNull();
    const tradeIn = list.tradeIn!;
    expect(tradeInDifference(tradeIn, '14 Pro', '15 Pro')).toBe(210);
    expect(tradeInDifference(tradeIn, '17 Pro Max', '18 Pro Max Sellado')).toBe(530);
  });

  test('a page whose examples disagree with its formula yields no trade-in, but still a catalog', () => {
    const broken = parsePriceList(PAGE.replace("['14 Pro','15 Pro',210]", "['14 Pro','15 Pro',999]"));
    expect(PAGE).toContain("['14 Pro','15 Pro',210]");
    expect(broken.tradeIn).toBeNull();
    expect(broken.iphones.length).toBe(27);
  });

  test('a page without the catalog, or with a malformed one, throws', () => {
    expect(() => parsePriceList('<html><body>maintenance</body></html>')).toThrow(/no catalog script/);
    expect(() => parsePriceList(PAGE.replace("['13','128 GB',290,", "['13','128 GB','gratis',"))).toThrow();
    expect(() => parsePriceList(PAGE.replace("['13','128 GB',290,", "['13','mucho',290,"))).toThrow(/capacity/);
  });

  test('quotes by model name in any spelling and refuses what the calculator refuses', () => {
    const tradeIn = list.tradeIn!;
    expect(quoteTradeIn(tradeIn, 'iPhone 14 Pro', 'iphone 15 pro')).toEqual({ ok: true, have: 'iPhone 14 Pro', want: 'iPhone 15 Pro', difference_usd: 210 });
    expect(quoteTradeIn(tradeIn, '15 pro', '18 Pro')).toMatchObject({ ok: true, want: 'iPhone 18 Pro Sellado', difference_usd: 900 });
    expect(quoteTradeIn(tradeIn, '15 Pro', '14 Pro')).toMatchObject({ ok: false, reason: 'not_higher_value' });
    expect(quoteTradeIn(tradeIn, '12', '15 Pro')).toMatchObject({ ok: false, reason: 'unknown_have' });
    expect(quoteTradeIn(tradeIn, '18 Pro', '18 Pro Max')).toMatchObject({ ok: false, reason: 'unknown_have' });
    expect(quoteTradeIn(tradeIn, '14 Pro', 'Galaxy S24')).toMatchObject({ ok: false, reason: 'unknown_want' });
  });
});

describe('Mobik accessories parser', () => {
  const accessories = parseAccessories(JSON.parse(STORE));

  test('reads price in pesos, sub-categories, compatible models and colors', () => {
    expect(accessories.length).toBe(11);
    expect(accessories.find((a) => a.id === 'silicone-case')).toMatchObject({
      name: 'Funda Silicone iPhone',
      categories: ['Fundas', 'Ofertas'],
      price_ars: 7800,
      colors: ['Celeste', 'Naranja', 'Negro', 'Rojo', 'Rosa'],
      in_stock: true,
    });
    expect(accessories.find((a) => a.id === 'silicone-case')?.compatible_models).toContain('iPhone 15 Pro');
    expect(accessories.find((a) => a.id === 'base-cargador-20w-usa')).toMatchObject({
      type: 'Original',
      price_ars: 12560,
      image_url: `${UPLOADS}/2026/03/base-cargador-usa-20w.png`,
    });
    expect(accessories.every((a) => a.image_url !== null)).toBe(true);
  });

  test('a placeholder price becomes "price on request" and another currency is refused', () => {
    const raw = JSON.parse(STORE) as any[];
    const placeholder = raw.map((p, i) => (i === 0 ? { ...p, prices: { ...p.prices, price: '1' } } : p));
    expect(parseAccessories(placeholder)[0]?.price_ars).toBeNull();
    const dollars = raw.map((p, i) => (i === 0 ? { ...p, prices: { ...p.prices, currency_code: 'USD' } } : p));
    expect(() => parseAccessories(dollars)).toThrow(/expected ARS/);
  });
});

describe('Mobik pictures', () => {
  const gallery = parseGallery(JSON.parse(GALLERY));

  test('a resized rendition becomes the original upload; anything unusable becomes null', () => {
    expect(fullSizeImage(`${UPLOADS}/2026/04/iphone-17-pro-max-naranja-400x488.png`)).toBe(`${UPLOADS}/2026/04/iphone-17-pro-max-naranja.png`);
    expect(fullSizeImage(`${UPLOADS}/2026/04/iphone-17-pro-max-naranja.png`)).toBe(`${UPLOADS}/2026/04/iphone-17-pro-max-naranja.png`);
    expect(fullSizeImage(`${UPLOADS}/2026/03/IMG_6718-scaled.jpeg`)).toBe(`${UPLOADS}/2026/03/IMG_6718-scaled.jpeg`);
    expect(fullSizeImage(`${UPLOADS}/2026/03/funda.webp`)).toBeNull();
    expect(fullSizeImage('http://mobikiphones.com.ar/wp-content/uploads/a.png')).toBeNull();
    expect(fullSizeImage('https://cdn.example/wp-content/uploads/a.png')).toBeNull();
    expect(fullSizeImage('not a url')).toBeNull();
  });

  test('picks a picture of the model in the color, translating the price list color names', () => {
    expect(pickColorImage(gallery, '17 Pro Max', 'Naranja')).toBe(`${UPLOADS}/2026/04/iphone-17-pro-max-naranja.png`);
    expect(pickColorImage(gallery, '17 Pro Max', 'Orange')).toBe(pickColorImage(gallery, '17 Pro Max', 'Naranja'));
    expect(pickColorImage(gallery, '14 Pro', 'Purple')).not.toBeNull();
    expect(pickColorImage(gallery, '14 Pro', 'Purple')).not.toBe(pickColorImage(gallery, '14 Pro', 'Negro'));
    expect(pickColorImage(gallery, '15 Pro', 'Negro')).not.toBe(pickColorImage(gallery, '15 Pro Max', 'Negro'));
  });

  test('no picture for a model or a color the store does not show', () => {
    expect(pickColorImage(gallery, '16 Pro', 'Negro')).toBeNull();
    expect(pickColorImage(gallery, '15 Pro', 'Fucsia')).toBeNull();
    expect(pickColorImage({}, '15 Pro', 'Negro')).toBeNull();
  });
});

describe('Mobik FAQ parser', () => {
  const faq = parseFaqPage(FAQ, 'faq', FAQ_URL);
  const shipping = parseFaqPage(SHIPPING, 'shipping_policy', SHIPPING_POLICY_URL);

  test('reads each question with its answer and drops the numbering', () => {
    expect(faq[0]).toEqual({
      source: 'faq',
      question: '¿Hacen envíos?',
      answer: '¡Sí! Realizamos envíos a todo el país por Correo Argentino o Andreani.',
      source_url: FAQ_URL,
    });
    expect(shipping.map((e) => e.question)).toContain('¿Cómo se calcula el costo del envío?');
  });

  test('leaves out warranty and payment entries, which the owner-fed tools answer', () => {
    expect(FAQ).toContain('¿Ofrecen garantía?');
    expect(FAQ).toContain('¿Qué formas de pago aceptan?');
    expect(SHIPPING).toMatch(/tienen garantía\?/);
    expect(faq.map((e) => e.question)).toEqual(['¿Hacen envíos?', '¿Cuánto tarda en llegar mi pedido?', '¿Se pueden realizar cambios?']);
    expect(shipping.length).toBe(7);
    expect([...faq, ...shipping].some((e) => /garant|forma de pago/i.test(e.question))).toBe(false);
  });

  test('a page with no question blocks throws', () => {
    expect(() => parseFaqPage('<html><body>maintenance</body></html>', 'faq', FAQ_URL)).toThrow(/no question-and-answer blocks/);
  });

  test('search matches words in the question or the answer, ignoring accents', () => {
    expect(searchFaq([...faq, ...shipping], 'envios').length).toBeGreaterThanOrEqual(3);
    expect(searchFaq([...faq, ...shipping], 'andreani').map((e) => e.source)).toEqual(['faq', 'shipping_policy']);
    expect(searchFaq(faq, undefined).length).toBe(3);
  });
});

describe('cached source', () => {
  const setup = (ttlMs = 60_000) => {
    const state = { clock: 1_000_000, loads: 0, fail: false, next: 'live-1' };
    const read = createCachedSource<string>({
      ttlMs,
      now: () => state.clock,
      fallback: { value: 'shipped', read_at: '2026-01-01T00:00:00.000Z' },
      load: async () => {
        state.loads++;
        if (state.fail) {
          throw new Error('down');
        }
        return state.next;
      },
    });
    return { state, read };
  };

  test('reads once within the TTL and again after it', async () => {
    const { state, read } = setup();
    expect(await read()).toMatchObject({ value: 'live-1', stale: false });
    state.next = 'live-2';
    state.clock += 59_999;
    expect((await read()).value).toBe('live-1');
    expect(state.loads).toBe(1);
    state.clock += 1;
    expect((await read()).value).toBe('live-2');
    expect(state.loads).toBe(2);
  });

  test('concurrent callers share one read', async () => {
    const { state, read } = setup();
    await Promise.all([read(), read(), read()]);
    expect(state.loads).toBe(1);
  });

  test('a failed read keeps the last good value, marks it stale and waits a TTL before retrying', async () => {
    const { state, read } = setup();
    const first = await read();
    state.fail = true;
    state.clock += 60_000;
    expect(await read()).toEqual({ ...first, stale: true });
    state.clock += 30_000;
    await read();
    expect(state.loads).toBe(2);
    state.fail = false;
    state.next = 'recovered';
    state.clock += 30_000;
    expect(await read()).toMatchObject({ value: 'recovered', stale: false });
  });

  test('with the store down from the start it serves the shipped copy with its own date', async () => {
    const { state, read } = setup();
    state.fail = true;
    expect(await read()).toEqual({ value: 'shipped', read_at: '2026-01-01T00:00:00.000Z', stale: true });
  });
});

describe('Mobik shipped snapshot', () => {
  test('is a valid catalog and carries no trade-in table', () => {
    const snapshot = loadSnapshot();
    expect(snapshot.iphones.length).toBeGreaterThan(10);
    expect(snapshot.accessories.length).toBeGreaterThan(5);
    expect(snapshot.faq.length).toBeGreaterThan(5);
    expect(Object.keys(snapshot)).toEqual(['read_at', 'iphones', 'accessories', 'faq']);
  });
});

describe('Mobik tenant', () => {
  test('offers exactly nine tools', async () => {
    const { tools } = await (await connect({ fetcher: fakeStore().fetcher })).listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      'get_business_info',
      'get_faq',
      'get_payment_methods',
      'get_product',
      'get_reservation_info',
      'get_trade_in_quote',
      'get_warranty',
      'list_categories',
      'search_products',
    ]);
  });

  test('"tenés iPhone 15 Pro?" lists the published units with battery, color and USD price', async () => {
    const client = await connect({ fetcher: fakeStore().fetcher });
    const result = await call(client, 'search_products', { query: '15 pro', kind: 'iphone', storage_gb: 128 });
    expect(result.structuredContent?.iphones.map((p: any) => p.id)).toEqual(['iphone-15-pro-128gb-used']);
    expect(result.content[0]?.text).toContain('Negro, battery 84%, USD 555');
    expect(result.content[0]?.text).toContain('availability must be confirmed');
    expect(result.structuredContent?.stale).toBe(false);
  });

  test('condition, color and battery filters narrow the units; a sealed phone has none to narrow', async () => {
    const client = await connect({ fetcher: fakeStore().fetcher });
    const sealed = (await call(client, 'search_products', { condition: 'new', limit: 20 })).structuredContent;
    expect(sealed?.total_iphones).toBe(7);
    expect(sealed?.total_accessories).toBe(0);
    const healthy = (await call(client, 'search_products', { query: '14 pro', kind: 'iphone', storage_gb: 128, min_battery_pct: 90 })).structuredContent;
    expect(healthy?.iphones[0].units.map((u: any) => u.battery_pct)).toEqual([100, 100, 94]);
    const black = (await call(client, 'search_products', { query: '15 pro 128', condition: 'used', color: 'negro' })).structuredContent;
    expect(black?.iphones[0].units.map((u: any) => u.price_usd)).toEqual([580, 555]);
    const cheap = (await call(client, 'search_products', { kind: 'iphone', max_price: 300, limit: 20 })).structuredContent;
    expect(cheap?.iphones.map((p: any) => p.id)).toEqual(['iphone-13-128gb-used', 'iphone-14-128gb-used']);
    expect(cheap?.iphones.flatMap((p: any) => p.units.map((u: any) => u.price_usd)).every((price: number) => price <= 300)).toBe(true);
  });

  test('accessories are found by what they are and by the iPhone they fit, priced in pesos', async () => {
    const client = await connect({ fetcher: fakeStore().fetcher });
    const cases = (await call(client, 'search_products', { query: 'funda 15 pro', kind: 'accessory' })).structuredContent;
    expect(cases?.accessories.map((a: any) => a.id)).toEqual(['funda-magsafe', 'funda-transparente-iphone', 'silicone-case']);
    expect(cases?.total_iphones).toBe(0);
    const affordable = (await call(client, 'search_products', { kind: 'accessory', max_price: 5000 })).structuredContent;
    expect(affordable?.accessories.map((a: any) => a.id)).toEqual(['vidrio-templado-9d']);
  });

  test('a price filter without kind is refused, because the currencies differ', async () => {
    const client = await connect({ fetcher: fakeStore().fetcher });
    const result = await call(client, 'search_products', { max_price: 500 });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/needs `kind`/);
  });

  test('get_product answers an iPhone with its warranty, an accessory with its details, and suggests on a miss', async () => {
    const client = await connect({ fetcher: fakeStore().fetcher });
    const used = (await call(client, 'get_product', { id: 'iphone-15-pro-128gb-used' })).structuredContent;
    expect(used).toMatchObject({ kind: 'iphone', accessory: null });
    expect(used?.warranty).toMatch(/30 días/);
    expect((await call(client, 'get_product', { id: 'iphone-17-pro-256gb-new' })).structuredContent?.warranty).toMatch(/1 año/);
    expect((await call(client, 'get_product', { id: 'battery-pack' })).structuredContent).toMatchObject({ kind: 'accessory', iphone: null, warranty: null });
    const miss = await call(client, 'get_product', { id: 'iphone-15-pro' });
    expect(miss.isError).toBe(true);
    expect(miss.content[0]?.text).toContain('iphone-15-pro-128gb-used');
  });

  test('list_categories counts models and accessory categories', async () => {
    const result = (await call(await connect({ fetcher: fakeStore().fetcher }), 'list_categories')).structuredContent;
    expect(result?.iphone_models.find((m: any) => m.model === 'iPhone 17 Pro')).toEqual({ model: 'iPhone 17 Pro', listings: 2, used_units: 3, sealed: true });
    expect(result?.accessory_categories.find((c: any) => c.category === 'Fundas')).toEqual({ category: 'Fundas', count: 3 });
  });

  test('warranty is one year from Apple on new and thirty days from Mobik on used', async () => {
    const client = await connect({ fetcher: fakeStore().fetcher });
    const both = (await call(client, 'get_warranty')).structuredContent;
    expect(both?.warranties).toMatchObject([
      { condition: 'new', duration: '1 año', provider: 'Apple' },
      { condition: 'used', duration: '30 días', provider: 'Mobik' },
    ]);
    expect((await call(client, 'get_warranty', { condition: 'used' })).structuredContent?.warranties.length).toBe(1);
  });

  test('trade-in gives the difference only, never the value of the phone handed in', async () => {
    const client = await connect({ fetcher: fakeStore().fetcher });
    const quote = await call(client, 'get_trade_in_quote', { have_model: 'iPhone 14 Pro', want_model: '15 Pro' });
    expect(quote.structuredContent).toMatchObject({ have: 'iPhone 14 Pro', want: 'iPhone 15 Pro', difference_usd: 210 });
    expect(Object.keys(quote.structuredContent ?? {}).sort()).toEqual(['conditions', 'difference_usd', 'have', 'read_at', 'stale', 'want']);
    // The fixture values of the two phones (350 and 440) must not leak into the answer.
    expect(quote.content[0]?.text).not.toMatch(/350|440/);
    const refused = await call(client, 'get_trade_in_quote', { have_model: '15 Pro', want_model: '13' });
    expect(refused.isError).toBe(true);
    expect(refused.content[0]?.text).toMatch(/higher value/);
  });

  test('with the store down from the start there is a catalog (stale) but no trade-in quote', async () => {
    const store = fakeStore();
    store.state.down = true;
    const client = await connect({ fetcher: store.fetcher });
    const search = await call(client, 'search_products', { kind: 'iphone' });
    expect(search.structuredContent?.stale).toBe(true);
    expect(search.structuredContent?.total_iphones).toBeGreaterThan(0);
    expect(search.structuredContent?.iphones_read_at).toBe(loadSnapshot().read_at);
    expect(search.content[0]?.text).toContain('could not be reached');
    const quote = await call(client, 'get_trade_in_quote', { have_model: '14 Pro', want_model: '15 Pro' });
    expect(quote.isError).toBe(true);
    expect(quote.content[0]?.text).toMatch(/hand the quote to a person/);
  });

  test('the store is hit once per source within the TTL, across servers, and again after it', async () => {
    const store = fakeStore();
    let clock = 5_000_000;
    const tenant = createMobikTenant({ fetcher: store.fetcher, ttlSeconds: 60, now: () => clock });
    const open = async (): Promise<Client> => {
      const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
      const client = new Client({ name: 'test', version: '1' });
      await Promise.all([tenant.createServer().connect(serverSide), client.connect(clientSide)]);
      return client;
    };
    await call(await open(), 'search_products', { query: '15' });
    await call(await open(), 'get_product', { id: 'battery-pack' });
    await call(await open(), 'list_categories');
    expect(store.state.hits.sort()).toEqual([PRICE_LIST_URL, ACCESSORIES_URL, GALLERY_URL].sort());
    clock += 60_000;
    store.state.page = PAGE.replace("[84,'Negro',555]", "[84,'Negro',545]");
    const fresh = await call(await open(), 'get_product', { id: 'iphone-15-pro-128gb-used' });
    expect(fresh.structuredContent?.iphone.price_usd).toBe(545);
    // The price list and the accessories were read again; the picture gallery is kept for an hour.
    expect(store.state.hits.length).toBe(5);
    expect(store.state.hits.filter((url) => url === GALLERY_URL).length).toBe(1);
  });

  test('a sold unit disappears from the answers after the next read; a broken page keeps the last good list', async () => {
    const store = fakeStore();
    let clock = 0;
    const client = await connect({ fetcher: store.fetcher, now: () => clock });
    const units = async () => (await call(client, 'get_product', { id: 'iphone-15-pro-256gb-used' })).structuredContent;
    expect((await units())?.iphone.units.length).toBe(2);
    clock += 60_000;
    store.state.page = PAGE.replace("[[100,'Negro',630],[88,'Blanco',600]]", "[[88,'Blanco',600]]");
    expect((await units())?.iphone.units).toMatchObject([{ battery_pct: 88, color: 'Blanco', price_usd: 600 }]);
    clock += 60_000;
    store.state.page = '<html><body>Error establishing a database connection</body></html>';
    const kept = await units();
    expect(kept?.iphone.units.length).toBe(1);
    expect(kept?.stale).toBe(true);
  });

  test('each unit carries a picture of its color, or the model picture when the store shows none for it', async () => {
    const client = await connect({ fetcher: fakeStore().fetcher });
    const result = await call(client, 'get_product', { id: 'iphone-17-pro-max-256gb-used' });
    const units = result.structuredContent?.iphone.units;
    expect(units.map((u: any) => u.color)).toEqual(['Naranja', 'Silver', 'Silver']);
    expect(units[0].image_url).toBe(`${UPLOADS}/2026/04/iphone-17-pro-max-naranja.png`);
    expect(units[1].image_url).not.toBe(units[0].image_url);
    expect(result.content[0]?.text).toContain(`| image ${UPLOADS}/2026/04/iphone-17-pro-max-naranja.png`);
    expect(result.content[0]?.text).toContain('illustrative');
    // The store has no iPhone 16 Pro product, so its units fall back to the price list picture of the model.
    const fallback = (await call(client, 'get_product', { id: 'iphone-16-pro-128gb-used' })).structuredContent?.iphone;
    expect(fallback.units.every((u: any) => u.image_url === fallback.image_url)).toBe(true);
    expect(fallback.image_url).toBe(`${UPLOADS}/2026/11/16-pro-y-pro-max.jpeg`);
    const sealed = await call(client, 'search_products', { query: '18 pro max', storage_gb: 256 });
    expect(sealed.content[0]?.text).toContain(`sealed, colors not listed | image ${UPLOADS}/2026/11/18-pro-y-pro-max-sellado.jpeg`);
    const funda = await call(client, 'search_products', { query: 'battery pack', kind: 'accessory' });
    expect(funda.content[0]?.text).toMatch(/\| image https:\/\/mobikiphones\.com\.ar\/wp-content\/uploads\/.+\.png/);
  });

  test('with the picture gallery down, phones still answer with the model picture', async () => {
    const store = fakeStore();
    const fetcher: Fetcher = async (url, init) => (url === GALLERY_URL ? new Response('nope', { status: 500 }) : store.fetcher(url, init));
    const phone = (await call(await connect({ fetcher }), 'get_product', { id: 'iphone-17-pro-max-256gb-used' })).structuredContent;
    expect(phone?.stale).toBe(false);
    expect(phone?.iphone.units.every((u: any) => u.image_url === `${UPLOADS}/2026/11/17-pro-y-pro-max.jpeg`)).toBe(true);
  });

  test('"hacen envíos?" is answered from the published FAQ and shipping policy', async () => {
    const store = fakeStore();
    const client = await connect({ fetcher: store.fetcher });
    const shipping = await call(client, 'get_faq', { query: 'envíos' });
    expect(shipping.content[0]?.text).toContain('Realizamos envíos a todo el país por Correo Argentino o Andreani.');
    expect(shipping.structuredContent?.sources).toEqual(['faq', 'shipping_policy']);
    expect(shipping.structuredContent?.stale).toBe(false);
    expect(store.state.hits.sort()).toEqual([SHIPPING_POLICY_URL, FAQ_URL].sort());
    const all = (await call(client, 'get_faq')).structuredContent;
    expect(all?.total).toBe(10);
    const none = await call(client, 'get_faq', { query: 'criptomonedas' });
    expect(none.structuredContent?.total).toBe(10);
    expect(none.content[0]?.text).toContain('Nothing matches "criptomonedas"');
    expect(store.state.hits.length).toBe(2);
  });

  test('a FAQ page that loses its shape keeps the shipped answers, marked stale', async () => {
    const store = fakeStore();
    store.state.faq = '<html><body>Error establishing a database connection</body></html>';
    const result = await call(await connect({ fetcher: store.fetcher }), 'get_faq', { query: 'envios' });
    expect(result.structuredContent?.stale).toBe(true);
    expect(result.structuredContent?.read_at).toBe(loadSnapshot().read_at);
    expect(result.structuredContent?.total).toBeGreaterThan(0);
  });

  test('payment methods apply each surcharge to a USD amount and never produce pesos', async () => {
    const client = await connect({ fetcher: fakeStore().fetcher });
    const result = (await call(client, 'get_payment_methods', { amount_usd: 550 })).structuredContent;
    const total = (id: string) => result?.methods.find((m: any) => m.id === id).total_usd;
    expect([total('usd_cash'), total('usdt'), total('usd_transfer'), total('ars_transfer')]).toEqual([550, 539, 566.5, 561]);
    expect(result?.methods.filter((m: any) => m.needs_exchange_rate).map((m: any) => m.id)).toEqual(['ars_cash', 'ars_transfer']);
    expect(result?.card_plans).toEqual([
      { instalments: 1, surcharge_pct: 10, total_usd: 605, per_instalment_usd: 605 },
      { instalments: 3, surcharge_pct: 20, total_usd: 660, per_instalment_usd: 220 },
      { instalments: 6, surcharge_pct: 40, total_usd: 770, per_instalment_usd: 128.33 },
      { instalments: 12, surcharge_pct: 50, total_usd: 825, per_instalment_usd: 68.75 },
    ]);
    const bare = (await call(client, 'get_payment_methods')).structuredContent;
    expect(bare?.methods.every((m: any) => m.total_usd === null)).toBe(true);
  });

  test('reservation gives the deposit and alias; holder and CBU only when configured', async () => {
    const without = (await call(await connect({ fetcher: fakeStore().fetcher }), 'get_reservation_info')).structuredContent;
    expect(without).toMatchObject({ deposit_ars: 20000, alias: 'mobikarg', validity_days: 7, holder: null, cbu: null });
    const configured = await call(await connect({ fetcher: fakeStore().fetcher, reservation: { holder: 'Test Holder', cbu: '0000000000000000000000' } }), 'get_reservation_info');
    expect(configured.structuredContent).toMatchObject({ holder: 'Test Holder', cbu: '0000000000000000000000' });
    expect(configured.content[0]?.text).toMatch(/confirmada solo cuando una persona/);
  });

  test('business info follows the two daily shifts, Monday to Saturday', async () => {
    const client = await connect({ fetcher: fakeStore().fetcher });
    const open = async (at: string) => (await call(client, 'get_business_info', { at })).structuredContent?.open_now;
    expect(await open('2026-11-09T10:00:00')).toBe(true); // Monday morning
    expect(await open('2026-11-09T14:30:00')).toBe(false); // Monday break
    expect(await open('2026-11-14T16:00:00')).toBe(true); // Saturday afternoon
    expect(await open('2026-11-14T19:30:00')).toBe(false); // closing minute
    expect(await open('2026-11-15T10:00:00')).toBe(false); // Sunday
  });
});
