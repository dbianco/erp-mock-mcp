# erp-mock-mcp: one server, three tenants

Date: 2026-10-23. Status: draft for the owner's approval.

## Intent

`erp-mock-mcp` is a mock the Textra AI agent (feature 025) calls through MCP. Today it answers only for
Casa Gigli and only about product prices. The owner wants the same mock to serve **three Textra tenants**, each
with its own tools and data, so the agent can be demonstrated in three different businesses:

1. **Casa Gigli** (retail, Noetinger): product prices, plus business info and tips/offers.
2. **Güemes Neumáticos** (tyre shop, Córdoba): business info, tyre prices, workshop services, maintenance tips.
3. **Observatorio Hidro-Meteorológico Córdoba (OHMC)**, https://ohmc.ar/: weather forecast, active alerts and
   other information useful to the public.

It stays a proof of concept and a deterministic fixture: read-only, fixed invented data, reproducible tests.

## Decisions taken by the owner

- **One server, one endpoint per tenant** (not three processes, not one mixed tool list).
- **Fixed, invented, reproducible data** for the weather tenant (no live calls to ohmc.ar).
- **Invented products, services and prices** for Güemes; invented tips and offers for Casa Gigli.
- Real business data (below) is loaded as given by the owner.
- Güemes offers, besides tyres, workshop services: wheel balancing, shock-absorber replacement, tyre rotation.
- Güemes tips include rotating tyres every 10,000 km and checking tyre pressure (plus others in the same spirit).

## Goals

- Each tenant registers in Textra with its own URL and sees **only its own tools**.
- No tenant can read another tenant's data: each route loads only its own dataset.
- Casa Gigli's existing three tools and their output shapes do not change.
- Every answer is deterministic: same input, same output, whatever day it is run.
- Adding a fourth tenant means adding one module and one registry entry, not editing the HTTP layer.

## Non-goals

- No live data, no scraping of ohmc.ar, no orders, stock, payments or writes.
- No per-tenant authentication beyond what exists (see "Auth").
- No change to how Textra registers MCP servers.

## Anti-goals (a failure even if it technically works)

- The weather data looks official. It is invented, and every weather answer must say so in the tool text
  (for example "datos de demostración, no oficiales") so the agent cannot present it as a real forecast or a real alert.
- A tenant's tools appearing under another tenant's URL (for example `get_forecast` under Güemes).
- A tool that invents a price, an opening hour or a phone number for a record that has none.

## Architecture

- Routes: `POST /casa-gigli/mcp`, `POST /guemes/mcp`, `POST /ohmc/mcp`, and `GET /health`.
  `POST /mcp` keeps answering as Casa Gigli, so what is already registered does not break
  (compatibility alias; the owner may remove it later).
- The server stays stateless: one MCP server and one transport per request, as `http.ts` does now.
- A **tenant module** declares: slug, display name, its dataset (loaded and validated at startup) and a function that
  registers its tools on an MCP server. A **registry** maps slug to module. An unknown slug answers 404.
- Data lives in `data/<tenant-slug>/`. The existing `data/catalog.json` and the build scripts move with Casa Gigli.
- `catalog.ts` and `categories.ts` today hard-code Casa Gigli's seven categories. They must become per-tenant
  (a tenant supplies its own category list); Güemes reuses the search code with its own categories.
- Tools return text plus `structuredContent`, with read-only annotations, as the current tools do.
  Tool descriptions are written for the model and tell it not to invent missing facts.

## Tenant 1: Casa Gigli

Existing tools unchanged: `search_products`, `get_product`, `list_categories`. New:

- `get_business_info` returns address, phone, weekly opening hours, Instagram and web.
  An optional `at` (ISO date-time) makes it also answer "open now?" in the time zone `America/Argentina/Cordoba`.
  Without `at` it never reads the clock.
- `get_tips_and_offers` returns invented purchase tips and current offers (for example instalments and cash discounts
  that match the catalog's existing cash/24-instalment model). Offers carry a validity text, not a computed date.

Real data (from the owner):

- Héroes de Malvinas 271, X2563 Noetinger, Córdoba. Phone 03472 47-0066.
- Mon, Tue, Wed, Thu, Fri 8:00 to 12:00 and 16:30 to 20:30; Saturday 8:30 to 12:30; Sunday closed.
- Instagram https://www.instagram.com/casa_gigli, web https://casagigli.com.ar/.

## Tenant 2: Güemes Neumáticos

Real data (from the owner):

- Julio A. Roca 987, X5000CQG Córdoba. Phone 0351 460-3165.
- Monday to Friday 8:30 to 18:00; Saturday and Sunday closed.
- Facebook https://www.facebook.com/p/G%C3%BCemes-Neum%C3%A1ticos-100041697807236/.

Tools:

- `get_business_info`: same shape and same optional `at` behaviour as Casa Gigli's.
- `search_products`, `get_product`, `list_categories`: about 15 invented tyres. Fields: brand, model, size
  (for example `205/55 R16`), vehicle type (car, SUV/pickup, motorcycle), list/cash price in ARS.
  Filters: free text, size, brand, vehicle type, price range. A size filter must match exactly after normalising spaces and case.
- `list_services`: invented workshop services with a "from" price and what is included: wheel balancing, shock-absorber
  replacement, tyre rotation, and (my call) alignment and tyre fitting.
- `get_maintenance_tips`: invented tips including tyre rotation every 10,000 km and pressure checks, plus
  (my call) tread-depth check, spare tyre check, and signs a shock absorber needs replacing. Optional `topic` filter.

## Tenant 3: OHMC

Real data (from https://ohmc.ar/, read 2026-10-23): Ituzaingó 1300, Parque de las Tejas, Córdoba; info@ohmc.ar;
Facebook, X, Instagram and YouTube. The site itself publishes **no forecast, no alerts and no list of towns**;
it links to a regional WRF model, GFS, the national weather service (SMN) and REPROMMAT (provincial early warning,
restricted access). Everything below is therefore invented demo data.

Tools:

- `list_localities`: the invented dataset's Córdoba localities. Minimum: Córdoba capital, Villa Carlos Paz,
  Río Cuarto, Villa María.
- `get_forecast(locality, extended?)`: today's forecast, or the extended 5-day forecast when `extended` is true.
  Fields: min/max temperature, condition, rain probability, wind. The forecast has a **fixed reference date** in the data,
  never today's date. An unknown locality answers an error that lists valid ones (with a "did you mean" hint, as `get_product` does).
- `get_active_alerts(locality?)`: one or two invented alerts (for example storm and heavy rain) with level,
  area, validity text and a recommended action. With no locality, all alerts.
- `get_current_conditions(locality)`: invented observation of an automatic weather station.
- `get_hydrological_levels(locality?)`: invented river and dam levels, matching what the site says its
  hydrological stations monitor.
- `get_business_info` (observatory contact, social networks, the COSECHEROS extreme-event reporting programme as information)
  and `get_monitoring_links` (radar, satellite, SMN, REPROMMAT as references to the real sources).
- Every weather tool's text says the data is demonstration data and not official.

## Auth

The existing `MCP_AUTH_TOKEN` stays one shared bearer token for all routes. Per-tenant tokens are out of scope.
Textra rejects loopback and private addresses, so the server is registered through one public `https` URL
with the tenant slug as the path (for example a Cloudflare quick tunnel).

## Testing

- Per tenant: tool outputs against the fixed data, including unknown ids, localities and categories.
- Isolation: calling `tools/list` on each route returns exactly that tenant's tools; a tool of one tenant called on another route fails.
- Opening hours: fixed `at` values for open, closed, between sessions, Saturday and Sunday, in the Córdoba time zone.
- Route table: unknown slug is 404; `/mcp` equals `/casa-gigli/mcp`.
- Existing 58 tests keep passing; their outputs for Casa Gigli do not change.

## Left to the builder

File and module layout, the shape of the tenant-module interface, the exact invented tyre, service, tip and offer
lists, the invented forecast values and alert texts, and how to split `catalog.ts`. The README is updated to describe
the routes, the tools per tenant and the "invented data" warning.
