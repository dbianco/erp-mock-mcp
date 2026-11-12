import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { dataFile, loadJson } from '../../data.js';
import { type Accessory, AccessorySchema } from './accessories.js';
import { DEFAULT_LIMIT, KINDS, didYouMean, findById, searchAccessories, searchIphones } from './catalog.js';
import { IPHONE_CONDITIONS, type Iphone, IphoneSchema, quoteTradeIn } from './price-list.js';
import type { Sources } from './sources.js';

const PoliciesSchema = z.object({
  source: z.string(),
  warranty: z.object({
    new: z.object({ duration: z.string(), provider: z.string(), summary: z.string() }),
    used: z.object({ duration: z.string(), provider: z.string(), summary: z.string() }),
    notes: z.array(z.string()),
  }),
  payment_methods: z.array(
    z.object({ id: z.string(), label: z.string(), adjustment_pct: z.number(), needs_exchange_rate: z.boolean(), note: z.string() }),
  ),
  card_plans: z.array(z.object({ instalments: z.number().int().positive(), surcharge_pct: z.number().min(0) })),
  card_note: z.string(),
  exchange_rate_note: z.string(),
  reservation: z.object({
    deposit_ars: z.number().positive(),
    deposit_note: z.string(),
    wallet: z.string(),
    alias: z.string(),
    validity_days: z.number().int().positive(),
    validity_note: z.string(),
    steps: z.array(z.string()),
    confirmation_note: z.string(),
  }),
});
export type Policies = z.infer<typeof PoliciesSchema>;
export const loadPolicies = (): Policies => loadJson(PoliciesSchema, dataFile('mobik', 'policies.json'));

/** Transfer details kept out of the repository; both come from the environment and may be absent. */
export interface ReservationSecrets {
  holder?: string;
  cbu?: string;
}

const AVAILABILITY_NOTE =
  'Listed means published on the price list, not reserved: availability must be confirmed by the Mobik team before promising a phone.';
const PARTS_NOTE =
  'The price list does not say whether a phone has replaced parts or repairs. Never state that parts are original; it is confirmed when the phone is inspected.';
const SEALED_NOTE = 'Sealed (new) phones: the price list gives a "from" price per capacity and does not list colors; confirm colors with the team.';

const failure = (text: string) => ({ isError: true as const, content: [{ type: 'text' as const, text }] });
const usd = (value: number): string => `USD ${new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(value)}`;
const ars = (value: number | null): string => (value === null ? 'price on request' : `$${new Intl.NumberFormat('es-AR').format(value)} ARS`);
const round2 = (value: number): number => Math.round(value * 100) / 100;
const storage = (gb: number): string => (gb >= 1024 ? `${gb / 1024} TB` : `${gb} GB`);
const freshness = (readAt: string, stale: boolean): string =>
  stale ? `Read from the store on ${readAt}; the store could not be reached just now, so this may be out of date.` : `Read from the store on ${readAt}.`;

const iphoneLines = (p: Iphone): string[] => [
  `${p.id} | ${p.name} ${storage(p.storage_gb)} | ${p.condition} | from ${usd(p.price_usd)}`,
  ...(p.units.length === 0
    ? ['  sealed, colors not listed']
    : p.units.map((u) => `  - ${u.color}, battery ${u.battery_pct}%, ${usd(u.price_usd)}`)),
];
const accessoryLine = (a: Accessory): string =>
  [
    a.id,
    a.name,
    a.categories.join('/') || 'accessory',
    ars(a.price_ars),
    ...(a.type === null ? [] : [a.type]),
    ...(a.compatible_models.length === 0 ? [] : [`for ${a.compatible_models.join(', ')}`]),
    ...(a.colors.length === 0 ? [] : [`colors ${a.colors.join(', ')}`]),
    ...(a.in_stock ? [] : ['out of stock']),
  ].join(' | ');

const meta = { read_at: z.string(), stale: z.boolean() };

export function registerMobikTools(server: McpServer, sources: Sources, policies: Policies, secrets: ReservationSecrets): void {
  server.registerTool(
    'search_products',
    {
      title: 'Search iPhones and accessories',
      description:
        'Search what Mobik publishes right now: iPhones (new sealed and used) and Apple accessories. All filters are optional and combine. ' +
        `\`kind\` is ${KINDS.join(' or ')} (both when omitted). \`query\` matches words in the name ("15 pro", "funda magsafe", "cargador"); ` +
        'an accessory also matches the iPhone models it fits. iPhone filters: `condition` (new = sealed with Apple warranty, used = pre-owned), ' +
        '`storage_gb` (1 TB is 1024), `color`, `min_battery_pct` (used units only). `min_price`/`max_price` need `kind`, because iPhones are ' +
        'priced in USD and accessories in ARS pesos. A used iPhone lists each published unit with its color, battery health and USD price; ' +
        `a sealed one has only a "from" price. iPhones come cheapest first, then accessories cheapest first, ${DEFAULT_LIMIT} of each unless ` +
        '`limit` (1 to 20) is given. Never invent a model, color, battery percentage or price that is not in the answer, and never convert a ' +
        `USD price to pesos. ${AVAILABILITY_NOTE} ${PARTS_NOTE}`,
      inputSchema: {
        query: z.string().max(200).optional(),
        kind: z.enum(KINDS).optional(),
        condition: z.enum(IPHONE_CONDITIONS).optional(),
        storage_gb: z.number().int().min(1).optional(),
        color: z.string().max(60).optional(),
        min_battery_pct: z.number().int().min(1).max(100).optional(),
        min_price: z.number().min(0).optional(),
        max_price: z.number().min(0).optional(),
        limit: z.number().int().min(1).max(20).optional(),
      },
      outputSchema: {
        total_iphones: z.number().int(),
        total_accessories: z.number().int(),
        iphones: z.array(IphoneSchema),
        accessories: z.array(AccessorySchema),
        iphones_read_at: z.string(),
        accessories_read_at: z.string(),
        stale: z.boolean(),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ query, kind, condition, storage_gb, color, min_battery_pct, min_price, max_price, limit }) => {
      if (kind === undefined && (min_price !== undefined || max_price !== undefined)) {
        return failure('A price filter needs `kind`: iPhones are priced in USD and accessories in ARS pesos.');
      }
      const iphoneOnly = condition !== undefined || storage_gb !== undefined || min_battery_pct !== undefined;
      const search = {
        ...(query !== undefined && { query }),
        ...(condition !== undefined && { condition }),
        ...(storage_gb !== undefined && { storageGb: storage_gb }),
        ...(color !== undefined && { color }),
        ...(min_battery_pct !== undefined && { minBatteryPct: min_battery_pct }),
        ...(min_price !== undefined && { minPrice: min_price }),
        ...(max_price !== undefined && { maxPrice: max_price }),
      };
      const [priceList, accessories] = await Promise.all([sources.priceList(), sources.accessories()]);
      const phones = kind === 'accessory' ? [] : searchIphones(priceList.value.iphones, search);
      const extras = kind === 'iphone' || (kind === undefined && iphoneOnly) ? [] : searchAccessories(accessories.value, search);
      const max = limit ?? DEFAULT_LIMIT;
      const shownPhones = phones.slice(0, max);
      const shownExtras = extras.slice(0, max);
      const stale = (kind !== 'accessory' && priceList.stale) || (kind !== 'iphone' && accessories.stale);
      const text = [
        `${phones.length} iPhone listing(s), showing ${shownPhones.length}; ${extras.length} accessory(ies), showing ${shownExtras.length}.`,
        ...shownPhones.flatMap(iphoneLines),
        ...shownExtras.map(accessoryLine),
        ...(shownPhones.some((p) => p.units.length === 0) ? [SEALED_NOTE] : []),
        ...(shownPhones.length > 0 ? [AVAILABILITY_NOTE] : []),
        `iPhones: ${freshness(priceList.read_at, priceList.stale)} Accessories: ${freshness(accessories.read_at, accessories.stale)}`,
      ].join('\n');
      return {
        content: [{ type: 'text' as const, text }],
        structuredContent: {
          total_iphones: phones.length,
          total_accessories: extras.length,
          iphones: shownPhones,
          accessories: shownExtras,
          iphones_read_at: priceList.read_at,
          accessories_read_at: accessories.read_at,
          stale,
        },
      };
    },
  );

  server.registerTool(
    'get_product',
    {
      title: 'Get an iPhone or an accessory',
      description:
        'Get one product by its id (from search_products). An iPhone answers with its condition, capacity, the warranty that applies and every ' +
        'published unit (color, battery health, USD price); an accessory with its ARS price, the iPhone models it fits, colors and description. ' +
        `${AVAILABILITY_NOTE} ${PARTS_NOTE}`,
      inputSchema: { id: z.string().min(1).max(200) },
      outputSchema: {
        kind: z.enum(KINDS),
        iphone: IphoneSchema.nullable(),
        accessory: AccessorySchema.nullable(),
        warranty: z.string().nullable(),
        ...meta,
      },
      annotations: { readOnlyHint: true },
    },
    async ({ id }) => {
      const [priceList, accessories] = await Promise.all([sources.priceList(), sources.accessories()]);
      const phone = findById(priceList.value.iphones, id);
      if (phone !== undefined) {
        const warranty = policies.warranty[phone.condition].summary;
        const text = [...iphoneLines(phone), `warranty: ${warranty}`, AVAILABILITY_NOTE, PARTS_NOTE, freshness(priceList.read_at, priceList.stale)];
        return {
          content: [{ type: 'text' as const, text: text.join('\n') }],
          structuredContent: { kind: 'iphone' as const, iphone: phone, accessory: null, warranty, read_at: priceList.read_at, stale: priceList.stale },
        };
      }
      const accessory = findById(accessories.value, id);
      if (accessory !== undefined) {
        const text = [accessoryLine(accessory), accessory.description, accessory.url, freshness(accessories.read_at, accessories.stale)];
        return {
          content: [{ type: 'text' as const, text: text.filter((l) => l !== '').join('\n') }],
          structuredContent: { kind: 'accessory' as const, iphone: null, accessory, warranty: null, read_at: accessories.read_at, stale: accessories.stale },
        };
      }
      const candidates = didYouMean([...priceList.value.iphones.map((p) => p.id), ...accessories.value.map((a) => a.id)], id);
      return failure(`No product with id "${id}".${candidates.length > 0 ? ` Did you mean: ${candidates.join(', ')}?` : ' Use search_products to find it.'}`);
    },
  );

  server.registerTool(
    'list_categories',
    {
      title: 'List iPhone lines and accessory categories',
      description:
        'List what the catalog holds right now: each iPhone model with how many capacity listings and published used units it has and ' +
        'whether it is offered sealed, and each accessory category with its count.',
      inputSchema: {},
      outputSchema: {
        iphone_models: z.array(z.object({ model: z.string(), listings: z.number().int(), used_units: z.number().int(), sealed: z.boolean() })),
        accessory_categories: z.array(z.object({ category: z.string(), count: z.number().int() })),
        ...meta,
      },
      annotations: { readOnlyHint: true },
    },
    async () => {
      const [priceList, accessories] = await Promise.all([sources.priceList(), sources.accessories()]);
      const models = new Map<string, { model: string; listings: number; used_units: number; sealed: boolean }>();
      for (const phone of priceList.value.iphones) {
        const entry = models.get(phone.name) ?? { model: phone.name, listings: 0, used_units: 0, sealed: false };
        entry.listings++;
        entry.used_units += phone.units.length;
        entry.sealed ||= phone.condition === 'new';
        models.set(phone.name, entry);
      }
      const counts = new Map<string, number>();
      for (const category of accessories.value.flatMap((a) => (a.categories.length === 0 ? ['Otros'] : a.categories))) {
        counts.set(category, (counts.get(category) ?? 0) + 1);
      }
      const iphone_models = [...models.values()];
      const accessory_categories = [...counts.entries()].map(([category, count]) => ({ category, count })).sort((a, b) => a.category.localeCompare(b.category));
      const text = [
        'iPhones:',
        ...iphone_models.map((m) => `${m.model}: ${m.listings} listing(s), ${m.used_units} used unit(s)${m.sealed ? ', sealed available' : ''}`),
        'Accessories:',
        ...accessory_categories.map((c) => `${c.category}: ${c.count}`),
      ].join('\n');
      return {
        content: [{ type: 'text' as const, text }],
        structuredContent: { iphone_models, accessory_categories, read_at: priceList.read_at, stale: priceList.stale || accessories.stale },
      };
    },
  );

  server.registerTool(
    'get_warranty',
    {
      title: 'Warranty by condition',
      description:
        'The warranty Mobik gives: 1 year from Apple on new (sealed) iPhones, 30 days from Mobik on used ones. Pass `condition` to get only ' +
        'one. The coverage details and exclusions are not published: never promise what the warranty covers, and hand a warranty claim to a person.',
      inputSchema: { condition: z.enum(IPHONE_CONDITIONS).optional() },
      outputSchema: {
        warranties: z.array(z.object({ condition: z.enum(IPHONE_CONDITIONS), duration: z.string(), provider: z.string(), summary: z.string() })),
        notes: z.array(z.string()),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ condition }) => {
      const warranties = IPHONE_CONDITIONS.filter((c) => condition === undefined || c === condition).map((c) => ({ condition: c, ...policies.warranty[c] }));
      const text = [...warranties.map((w) => `${w.condition}: ${w.summary}`), ...policies.warranty.notes].join('\n');
      return { content: [{ type: 'text' as const, text }], structuredContent: { warranties, notes: policies.warranty.notes } };
    },
  );

  server.registerTool(
    'get_trade_in_quote',
    {
      title: 'Trade-in difference (plan canje)',
      description:
        'Quote the plan canje: the estimated difference in USD a customer pays to hand in their iPhone and take another one. `have_model` is ' +
        'the iPhone they hand in (13 to 17 lines, e.g. "14 Pro"), `want_model` the one they want (e.g. "15 Pro", "18 Pro Max"). The quote ' +
        "depends on the two models only, exactly like the calculator on Mobik's site: capacity, battery health and condition are checked when " +
        'the phone is inspected and can change it. Always say the quote is an estimate subject to availability and to Mobik inspecting the ' +
        'phone. The tool never reveals how much the handed-in phone is valued at: do not state or guess that figure, and do not derive it ' +
        'from a list price.',
      inputSchema: { have_model: z.string().min(1).max(60), want_model: z.string().min(1).max(60) },
      outputSchema: {
        have: z.string(),
        want: z.string(),
        difference_usd: z.number(),
        conditions: z.array(z.string()),
        ...meta,
      },
      annotations: { readOnlyHint: true },
    },
    async ({ have_model, want_model }) => {
      const priceList = await sources.priceList();
      const tradeIn = priceList.value.tradeIn;
      if (tradeIn === null) {
        return failure('The trade-in calculator cannot be read from the store right now. Do not estimate a figure: hand the quote to a person of the Mobik team.');
      }
      const quote = quoteTradeIn(tradeIn, have_model, want_model);
      if (!quote.ok) {
        const reasons = {
          unknown_have: `Mobik does not take "${have_model}" in part payment through the calculator. Accepted: ${quote.accepted.join(', ')}. For any other phone, hand the quote to a person.`,
          unknown_want: `"${want_model}" is not a model the calculator offers. For an ${have_model} the options are: ${quote.offered.join(', ') || 'none'}.`,
          not_higher_value: `The plan canje only goes towards a model of higher value than the one handed in. For an ${have_model} the options are: ${quote.offered.join(', ') || 'none'}.`,
        };
        return failure(reasons[quote.reason]);
      }
      const conditions = [
        'Estimate only: subject to availability and to Mobik inspecting the phone handed in (capacity, battery health, cosmetic state, replaced parts).',
        'It does not depend on which unit of the wanted model is chosen; the final figure is confirmed by the team.',
      ];
      const text = [`${quote.have} -> ${quote.want}: estimated difference to pay ${usd(quote.difference_usd)}.`, ...conditions, freshness(priceList.read_at, priceList.stale)].join('\n');
      return {
        content: [{ type: 'text' as const, text }],
        structuredContent: { have: quote.have, want: quote.want, difference_usd: quote.difference_usd, conditions, read_at: priceList.read_at, stale: priceList.stale },
      };
    },
  );

  server.registerTool(
    'get_payment_methods',
    {
      title: 'Payment methods and surcharges',
      description:
        'The payment methods Mobik takes with their surcharge or discount: USD cash, USDT, USD transfer, pesos cash, pesos transfer, and credit ' +
        'card in 1, 3, 6 or 12 instalments. Pass `amount_usd` (a cash price or a trade-in difference) to get the total per method. Totals are ' +
        "in USD: pesos and card totals are the USD equivalent, converted at Banco Nación's selling rate at the time of the operation, which " +
        'this service does not know. Tell the customer that rule; never state an amount in pesos for an iPhone or guess an exchange rate.',
      inputSchema: { amount_usd: z.number().positive().max(100000).optional() },
      outputSchema: {
        amount_usd: z.number().nullable(),
        methods: z.array(
          z.object({
            id: z.string(),
            label: z.string(),
            adjustment_pct: z.number(),
            needs_exchange_rate: z.boolean(),
            note: z.string(),
            total_usd: z.number().nullable(),
          }),
        ),
        card_plans: z.array(
          z.object({ instalments: z.number().int(), surcharge_pct: z.number(), total_usd: z.number().nullable(), per_instalment_usd: z.number().nullable() }),
        ),
        notes: z.array(z.string()),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ amount_usd }) => {
      const amount = amount_usd ?? null;
      const total = (pct: number): number | null => (amount === null ? null : round2(amount * (1 + pct / 100)));
      const methods = policies.payment_methods.map((m) => ({ ...m, total_usd: total(m.adjustment_pct) }));
      const card_plans = policies.card_plans.map((plan) => {
        const total_usd = total(plan.surcharge_pct);
        return { ...plan, total_usd, per_instalment_usd: total_usd === null ? null : round2(total_usd / plan.instalments) };
      });
      const notes = [policies.card_note, policies.exchange_rate_note];
      const shown = (value: number | null, pesos: boolean): string => (value === null ? '' : ` -> ${usd(value)}${pesos ? " (USD equivalent, paid in pesos at Banco Nación's selling rate at the time of the operation)" : ''}`);
      const text = [
        ...(amount === null ? [] : [`On ${usd(amount)}:`]),
        ...methods.map((m) => `${m.label}: ${m.note}${shown(m.total_usd, m.needs_exchange_rate)}`),
        ...card_plans.map(
          (p) =>
            `Card, ${p.instalments} instalment(s): +${p.surcharge_pct}%${shown(p.total_usd, true)}${p.per_instalment_usd === null || p.instalments === 1 ? '' : `, ${usd(p.per_instalment_usd)} each`}`,
        ),
        ...notes,
      ].join('\n');
      return { content: [{ type: 'text' as const, text }], structuredContent: { amount_usd: amount, methods, card_plans, notes } };
    },
  );

  server.registerTool(
    'get_reservation_info',
    {
      title: 'How to reserve a phone (seña)',
      description:
        'How a customer reserves an iPhone with a deposit (seña): the amount in pesos, where to transfer it, how long the reservation holds and ' +
        'the steps. A reservation is confirmed only by a person of the Mobik team after checking the payment: never tell a customer that a ' +
        'phone is reserved or that a deposit was received. When `holder` or `cbu` is null, say the team will send that detail; never invent it.',
      inputSchema: {},
      outputSchema: {
        deposit_ars: z.number(),
        deposit_note: z.string(),
        wallet: z.string(),
        alias: z.string(),
        holder: z.string().nullable(),
        cbu: z.string().nullable(),
        validity_days: z.number().int(),
        validity_note: z.string(),
        steps: z.array(z.string()),
        confirmation_note: z.string(),
      },
      annotations: { readOnlyHint: true },
    },
    async () => {
      const r = policies.reservation;
      const holder = secrets.holder ?? null;
      const cbu = secrets.cbu ?? null;
      const text = [
        `Deposit: ${ars(r.deposit_ars)}. ${r.deposit_note}`,
        `Transfer to ${r.wallet}, alias ${r.alias}; holder ${holder ?? 'sent by the team'}; CBU ${cbu ?? 'sent by the team'}.`,
        r.validity_note,
        ...r.steps.map((step, i) => `${i + 1}. ${step}`),
        r.confirmation_note,
      ].join('\n');
      return { content: [{ type: 'text' as const, text }], structuredContent: { ...r, holder, cbu } };
    },
  );
}
