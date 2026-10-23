# erp-mock-mcp

A read-only mock of three businesses, exposed as MCP servers so the Textra AI agent (feature 025) can answer
questions about each of them. One process serves three Textra tenants, each on its own URL with only its own
tools and data. It is both a demo and a deterministic fixture: no orders, stock, payments or live data.

| Tenant | Route | Tools |
|---|---|---|
| Casa Gigli (retail, Noetinger) | `POST /casa-gigli/mcp` | `search_products`, `get_product`, `list_categories`, `get_business_info`, `get_tips_and_offers` |
| Güemes Neumáticos (tyre shop, Córdoba) | `POST /guemes/mcp` | `search_products`, `get_product`, `list_categories`, `get_business_info`, `list_services`, `get_maintenance_tips` |
| Observatorio Hidro-Meteorológico Córdoba | `POST /ohmc/mcp` | `list_localities`, `get_forecast`, `get_active_alerts`, `get_current_conditions`, `get_hydrological_levels`, `get_monitoring_links`, `get_business_info` |

`POST /mcp` answers as Casa Gigli, so registrations made before multi-tenancy keep working. `GET /health` is open.
Any other path, an unknown slug included, is a 404.

## Run

```bash
npm install
npm start            # http://127.0.0.1:8788/<slug>/mcp
npm test             # run it and read the count; it grows with the tenants
npm run typecheck
```

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `8788` | Listening port (bound to 127.0.0.1) |
| `MCP_AUTH_TOKEN` | unset | If set, every `POST` to a tenant route needs `Authorization: Bearer <token>` (one token for all tenants) |
| `IMAGE_BASE_URL` | `https://casagigli.com.ar/mcp/images` | Where Casa Gigli's product pictures are hosted (the other tenants have none) |

The server is stateless: `POST /<slug>/mcp` (Streamable HTTP) and `GET /health`. A dataset that fails validation stops
the server at startup.
The Textra platform refuses loopback and private addresses, so register each tenant through a public `https` URL
(for example a Cloudflare quick tunnel): `https://<public-host>/casa-gigli/mcp`, `https://<public-host>/guemes/mcp`
and `https://<public-host>/ohmc/mcp`.

## Tools

**`get_business_info`** (all tenants) returns name, address, phone, e-mail, links, weekly hours and notes. Pass `at`
(ISO 8601 date-time; no offset means Córdoba time, `America/Argentina/Cordoba`) to also get `open_now`. A range is open
from its opening minute up to, not including, its closing minute. A tenant with no published hours (OHMC) answers `null`.

**Casa Gigli.** `search_products` — `query`, `category`, `min_price`, `max_price` (cash price, ARS), `limit` (1 to 20,
default 5), cheapest first, products with no price last and excluded by a price filter. `get_product` — by id, SKU or
variant SKU: list, cash and 24-instalment prices, the derived discount, variants, `image_url` and a Spanish
`image_caption`. `list_categories` — the seven categories with counts. `get_tips_and_offers` — purchase tips and
advertised offers (`kind` = `tips` or `offers` narrows it). A product without a price answers `price on request`; the
tools never invent one.

**Güemes Neumáticos.** `search_products` — `query`, `size` (`205/55 R16` in any spacing or case), `brand`,
`category` (vehicle type: `auto`, `camioneta`, `moto`), `min_price`, `max_price`, `limit`. `get_product` — by SKU.
`list_categories` — vehicle types with counts. `list_services` — balancing, shock-absorber replacement, rotation,
alignment and tyre fitting with a *starting* price. `get_maintenance_tips` — optional `topic`.

**OHMC.** `get_forecast` — `locality`, `extended` (false: today; true: five days). `get_active_alerts` — optional
`locality`; no alert for a locality is a normal answer. `get_current_conditions` and `get_hydrological_levels`
(rivers and dams). `get_monitoring_links` — the real sources the observatory points to. `list_localities`.

## Invented data

Only the business details are real: Casa Gigli's and Güemes' address, phone, hours and links come from the owner;
OHMC's address, e-mail and links come from https://ohmc.ar/ (read 2026-10-23). **Everything else is invented**: Güemes' tyres,
services, prices and tips; Casa Gigli's tips and offers; and all of OHMC's weather. https://ohmc.ar/ publishes no
forecast, no alert feed and no list of towns, so the forecasts, alerts, observations and river levels are made up, fixed
at the reference date 2026-10-23 and labelled "Datos de demostración, no oficiales" in every answer. Casa Gigli's
catalog and prices come from the seeded source table (below).

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
