import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { loadBusinessInfo, registerBusinessInfoTool } from '../business-info.js';
import { loadCatalog } from '../catalog.js';
import { dataFile, loadJson } from '../data.js';
import type { Tenant } from '../tenant.js';
import { TipSchema } from '../tips.js';
import { type ServerOptions, registerCatalogTools } from '../tools.js';

const SLUG = 'casa-gigli';

const OfferSchema = z.object({ id: z.string(), title: z.string(), text: z.string(), valid_text: z.string() });
const TipsAndOffersSchema = z.object({ tips: z.array(TipSchema), offers: z.array(OfferSchema) });
type TipsAndOffers = z.infer<typeof TipsAndOffersSchema>;

function registerTipsAndOffersTool(server: McpServer, data: TipsAndOffers): void {
  server.registerTool(
    'get_tips_and_offers',
    {
      title: 'Tips and offers',
      description:
        'Purchase and care tips for the products the store sells, and the offers currently advertised (cash price, ' +
        'instalments, pick-up). Pass `kind` = "tips" or "offers" to get only one list. Quote an offer only as the ' +
        'tool returns it, with its validity text; never invent a discount or a date.',
      inputSchema: { kind: z.enum(['tips', 'offers']).optional() },
      outputSchema: { tips: z.array(TipSchema), offers: z.array(OfferSchema) },
      annotations: { readOnlyHint: true },
    },
    async ({ kind }) => {
      const tips = kind === 'offers' ? [] : data.tips;
      const offers = kind === 'tips' ? [] : data.offers;
      const text = [
        ...tips.map((t) => `tip [${t.topic}] ${t.title}: ${t.text}`),
        ...offers.map((o) => `offer ${o.title}: ${o.text} (${o.valid_text})`),
      ].join('\n');
      return { content: [{ type: 'text' as const, text }], structuredContent: { tips, offers } };
    },
  );
}

export function createCasaGigliTenant(options: ServerOptions): Tenant {
  const catalog = loadCatalog();
  const business = loadBusinessInfo(SLUG);
  const tipsAndOffers = loadJson(TipsAndOffersSchema, dataFile(SLUG, 'tips.json'));
  return {
    slug: SLUG,
    name: 'Casa Gigli',
    createServer: () => {
      const server = new McpServer({ name: 'erp-mock-mcp', version: '0.1.0' });
      registerCatalogTools(server, catalog, options);
      registerBusinessInfoTool(server, business);
      registerTipsAndOffersTool(server, tipsAndOffers);
      return server;
    },
  };
}
