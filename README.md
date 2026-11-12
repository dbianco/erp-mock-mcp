# erp-mock-mcp

A read-only mock of six businesses, exposed as MCP servers so the Textra AI agent (feature 025) can answer
questions about each of them. One process serves six Textra tenants, each on its own URL with only its own
tools and data. It is both a demo and a deterministic fixture: no orders, stock, payments or live data, with one
exception: **Mobik reads its catalog from the store's site at request time**, behind a cache (see below).

| Tenant | Route | Tools |
|---|---|---|
| Casa Gigli (retail, Noetinger) | `POST /casa-gigli/mcp` | `search_products`, `get_product`, `list_categories`, `get_business_info`, `get_tips_and_offers` |
| Güemes Neumáticos (tyre shop, Córdoba) | `POST /guemes/mcp` | `search_products`, `get_product`, `list_categories`, `get_business_info`, `list_services`, `get_maintenance_tips` |
| Observatorio Hidro-Meteorológico Córdoba | `POST /ohmc/mcp` | `list_localities`, `get_forecast`, `get_active_alerts`, `get_current_conditions`, `get_hydrological_levels`, `get_monitoring_links`, `get_business_info` |
| APROSS (health insurer, Córdoba) | `POST /apross/mcp` | `get_business_info`, `get_authorities`, `list_health_programs`, `get_health_program`, `get_mobile_mammography`, `find_offices`, `get_contacts` |
| Low Battery (phone store) | `POST /low-battery/mcp` | `search_products`, `get_product`, `list_categories`, `compare_products`, `get_business_info` |
| Mobik iPhones (iPhone store, Córdoba) | `POST /mobik/mcp` | `search_products`, `get_product`, `list_categories`, `get_warranty`, `get_trade_in_quote`, `get_payment_methods`, `get_reservation_info`, `get_business_info` |

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
| `MOBIK_CACHE_TTL_SECONDS` | `60` | How long Mobik's catalog is served from memory before the store is read again (`0` reads on every call) |
| `MOBIK_RESERVATION_HOLDER`, `MOBIK_RESERVATION_CBU` | unset | Account holder and CBU for Mobik's reservation deposit; kept out of the repository, answered as `null` when unset |

The server is stateless: `POST /<slug>/mcp` (Streamable HTTP) and `GET /health`. A dataset that fails validation stops
the server at startup.
The Textra platform refuses loopback and private addresses, so register each tenant through a public `https` URL
(for example a Cloudflare quick tunnel): `https://<public-host>/casa-gigli/mcp`, `https://<public-host>/guemes/mcp`
`https://<public-host>/ohmc/mcp`, `https://<public-host>/apross/mcp`, `https://<public-host>/low-battery/mcp` and
`https://<public-host>/mobik/mcp`.

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

**APROSS.** `get_authorities` — Directorio and directores generales. `list_health_programs` / `get_health_program` —
the three programs on the site (Plan Materno Infantil, Calendario Nacional de Vacunación, prevención y control de la
obesidad); a null `who` means the site does not say who is eligible. `get_mobile_mammography` — requirements, cost, the
affiliate benefit (until 2026-10-31), the latest stop and figures. `find_offices` — `query` (locality, name or address)
and `kind` (`delegacion`, `subdelegacion`, `puesto`) over 28 + 9 + 21 offices. `get_contacts` — phones and e-mails by purpose.

**APROSS data is a snapshot, not invented.** It was read from https://www.apross.gov.ar/ on 2026-10-25 and every
dataset carries its `source_url` and `read_at`; nothing is fetched at request time. The site has no page on the mobile
mammography unit's figures beyond one news item, so `mammography.json` tags each figure `apross` or `press` (La Voz de
San Justo) with its date. To refresh, re-read the pages named in the `source_url` fields and edit `data/apross/*.json`;
`npm test` checks the shapes and the office counts.

**Low Battery.** `search_products` — `query`, `brand`, `condition` (`new`, `used`, `refurbished`), `storage_gb`, `ram_gb`,
`min_price`, `max_price` (list price in `currency`, `ARS` by default or `USD`), `in_stock_only`, `limit` (1 to 20, default 5),
cheapest first in that currency, phones with no price last and excluded by a price filter. Every phone carries its list and
cash price in both pesos and dollars. `get_product` — by slug or id; used phones show their battery health. `compare_products`
— two to four phones, with the cheapest. `list_categories` — brands with counts. A phone with no published price answers
`price on request`.

**Low Battery data is a snapshot, not invented.** The models and both prices were read from https://liberadosya.com/
(the pesos store and its dollar twin under `/us/`, joined by product id) on the date in `data/low-battery/products.json`
(`read_at`); each phone carries its `source_url`; nothing is fetched at request time. The store publishes no price for
about 40% of its phones, and those stay without one. When a phone has several colors at different prices the snapshot keeps
the lowest. The implied rate is about 1,580 ARS per USD. To refresh, run `npm run snapshot:low-battery` and `npm test`. The
business details (address, hours) are invented. The example WhatsApp template is in `docs/low-battery-template.md`.

**Mobik iPhones.** `search_products` — `query`, `kind` (`iphone`, `accessory`), and for iPhones `condition` (`new` =
sealed, `used`), `storage_gb`, `color`, `min_battery_pct`; `min_price`/`max_price` need `kind` because iPhones are in USD
and accessories in ARS; `limit` (1 to 20, default 5 of each). A used iPhone lists every published unit (color, battery
health, USD price); a sealed one has a "from" price and no colors. `get_product` — by id, with the warranty that applies.
`list_categories` — iPhone models and accessory categories. `get_warranty` — 1 year from Apple on new, 30 days from
Mobik on used. `get_trade_in_quote` — `have_model`, `want_model`: the estimated difference to pay in USD, never the value
of the phone handed in. `get_payment_methods` — surcharges per method and card plan, with totals for `amount_usd`; it
never produces pesos: pesos are taken at Banco Nación's selling rate at the time of the operation, which the server does not know. `get_reservation_info` — deposit, alias, validity.

**Mobik data is read live, not invented.** Two public sources on https://mobikiphones.com.ar/, both read with a plain
`GET` and no credentials:

| What | Source | Why |
|---|---|---|
| iPhones (new and used) and the trade-in calculator | the `/lista-de-precios/` page, whose inline script holds the catalog | The only place with each used unit's battery, the new/used split and USD prices |
| Accessories | the WooCommerce Store API, `/wp-json/wc/store/v1/products?category=accesorios` | Clean JSON with ARS prices, the iPhone models each one fits and colors |

The Store API also lists iPhones, but with placeholder prices (0, 1 and 50,000 pesos), a stock counter that starts at
100 and no battery or condition, so it is not used for them; where its prices disagree with the list, the USD list wins
(owner, 2026-11-12). Each source is cached for `MOBIK_CACHE_TTL_SECONDS`; concurrent requests share one read. If a read
fails, or the page no longer has the expected shape, the last good copy keeps being served with `stale: true` and its
`read_at`, and the store is not asked again until the TTL passes. Before the first successful read the server answers
from `data/mobik/snapshot.json` (refresh it with `npm run snapshot:mobik`). The trade-in table is never stored: the
store marks those values as internal, so a quote needs a live read and is refused otherwise. The calculator is trusted
only when our formula reproduces the worked examples the page itself ships. Warranty, payment methods, the reservation
deposit and the business details are fixed data from the owner (`data/mobik/policies.json`, `data/mobik/business.json`).
The tests never touch the network: they use `src/tenants/mobik/fixtures/` (the real page script, with the trade-in
values shifted by a constant, and the real API response trimmed to the fields that are read). The agent prompt is in
`docs/mobik/agent-prompt.md`.

## Invented data

Only the business details are real (Low Battery's are invented, see above): Casa Gigli's and Güemes' address, phone, hours and links come from the owner;
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
