# erp-mock-mcp

A read-only mock of an Odoo-style product catalog, exposed as an MCP server so the Textra AI agent
(feature 025) can answer shopper questions about products a store sells. It serves 20 seeded
products and is both a demo and a deterministic fixture. No orders, stock or payments.

## Run

```bash
npm install
npm start            # http://127.0.0.1:8788/mcp
npm test             # 62 tests
npm run typecheck
```

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `8788` | Listening port (bound to 127.0.0.1) |
| `MCP_AUTH_TOKEN` | unset | If set, `POST /mcp` needs `Authorization: Bearer <token>` |
| `IMAGE_BASE_URL` | `https://casagigli.com.ar/mcp/images` | Where product pictures are hosted |

The server is stateless: `POST /mcp` (Streamable HTTP) and `GET /health`.
The Textra platform refuses loopback and private addresses, so register it through a public
`https` URL (for example a Cloudflare quick tunnel), not `localhost`.

## Tools

- `search_products` — `query`, `category`, `min_price`, `max_price` (cash price, ARS), `limit`
  (1 to 20, default 5). Cheapest first; products with no price come last and are excluded by a price filter.
- `get_product` — by id, SKU or variant SKU. Returns list, cash and 24-instalment prices, the derived
  discount, variants, `image_url` and a Spanish `image_caption`.
- `list_categories` — the seven categories with counts.

A product without a price answers `price on request`; the tools never invent one.

## Data and pictures

```bash
npm run build:catalog   # regenerates data/casa-gigli/catalog.json from data/casa-gigli/source-catalog.psv
                        # and data/casa-gigli/image-sources.json
npm run check:images    # after deploying the pictures: every image_url answers 200 image/png
```

Pictures are 800 px wide PNGs in `assets/images`, copied by hand to the site that hosts them. Only products whose
picture could be verified against the catalog row have one (`jq '[.[] | select(.image_file)] | length' data/casa-gigli/catalog.json`);
the others have `image_url: null`. `data/casa-gigli/image-sources.json` records where each came from.

## Rights

The pictures in `assets/images` are product photos taken from the internet and kept here for a proof of
concept. The repository is public by the owner's decision (2026-10-15). If a rights holder asks for a
picture to be removed, delete the file, its entry in `data/casa-gigli/image-sources.json` and run `npm run build:catalog`.
