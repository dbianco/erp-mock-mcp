# erp-mock-mcp multi-tenant Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One `erp-mock-mcp` process answers for three Textra tenants (Casa Gigli, Güemes Neumáticos, OHMC), each on its own URL with only its own tools and data.

**Architecture:** A `Tenant` (slug + `createServer()`) per business, a registry mapping slug to tenant, and an HTTP layer that resolves `/<slug>/mcp` to a tenant before building the per-request MCP server (the stateless design in `src/http.ts` stays). Shared pieces (business info with opening hours, JSON loading) live in `src/`; each new tenant lives in `src/tenants/<slug>/` with its data in `data/<slug>/`. Casa Gigli's catalog code stays where it is.

**Tech Stack:** TypeScript (ESM, NodeNext), `@modelcontextprotocol/sdk` 1.32.1, `zod` 4.6.7, vitest 5. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-23-multi-tenant-mcp-design.md`

## Global Constraints

- Routes: `POST /casa-gigli/mcp`, `POST /guemes/mcp`, `POST /ohmc/mcp`, `GET /health`; `POST /mcp` answers as Casa Gigli. Unknown slug: 404 `{"error":"not_found"}`.
- Stateless: one `McpServer` and one transport per request. Read-only tools (`annotations: { readOnlyHint: true }`), text plus `structuredContent`.
- One shared bearer token (`MCP_AUTH_TOKEN`) for all routes. No new env vars.
- Every answer is deterministic: no tool reads the clock. The only time input is the optional `at` parameter.
- Time zone for opening hours: `America/Argentina/Cordoba` (fixed UTC-3, no daylight saving).
- Weather data is invented demo data; every OHMC tool's text and `structuredContent.disclaimer` say so ("Datos de demostración, no oficiales").
- A tool never invents a price, hour or phone number for a record that has none.
- Casa Gigli's existing three tools keep their names, inputs and output shapes; the existing 58 tests keep passing (paths aside).
- Source code, comments, identifiers, log and error messages in English; Spanish only in data (names, tips, offers, captions) as the existing code does.
- Commits: author `Daniel Oliva <dbianco@users.noreply.github.com>`. Use
  `GIT_AUTHOR_NAME="Daniel Oliva" GIT_AUTHOR_EMAIL="dbianco@users.noreply.github.com" GIT_COMMITTER_NAME="Daniel Oliva" GIT_COMMITTER_EMAIL="dbianco@users.noreply.github.com" git commit -m "..."`
  (abbreviated as `COMMIT` below) and end each message with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- All commands run from the repository root of the worktree (`cd` explicitly in every command).

## Calls made in this plan (the spec leaves them open)

- Güemes does **not** reuse `searchProducts`: that code is typed to Casa Gigli's `Product` and category enum, and tyres need brand and size. Güemes gets its own small `tyres.ts`; both share only `src/text.ts` (`normalise`, `tokenise`).
- `at` without a UTC offset is read as Córdoba local time; `at` with an offset is honoured. A range is half-open: open at `open`, closed at `close`.
- Tyre size comparison keeps digits only (`205/55 R16`, `205/55R16` and `205/55r16` are equal).
- `mon..sun` day keys in data; Spanish day names are only in the tool text if the builder wants them.
- Alias `POST /mcp` is resolved in the HTTP layer through `DEFAULT_TENANT = 'casa-gigli'`.
- The alias returns Casa Gigli's full tool list, new tools included (Textra only exposes the tools its tenant allowlists).
- A bad `at` is an `isError` result (no partial answer). An unknown slug is 404 before the bearer check, as every non-`/mcp` path is today; a known slug with `GET` is 405.
- Any tenant dataset that fails validation stops the server at startup (fail fast); no tenant is served half-loaded.
- Only Casa Gigli has pictures: `IMAGE_BASE_URL` stays one global setting used by that tenant alone. Güemes and OHMC tools return no image fields.
- Forecast days carry absolute ISO dates (`2026-10-23` …); "today" is the first day of the series, labelled with that date. An alert lists the locality slugs it covers, so a regional alert names several localities and `get_active_alerts(locality)` filters on that list.
- Locality matching uses `normalise` (case- and accent-insensitive), plus slugs.
- Existing tests may change file paths (Task 1) but not their assertions.

## Review Focus

Each line has its test in the task named.

1. `at` is garbage (`"mañana"`) or an impossible date: an `isError` result naming the expected format, never a crash or `NaN` (Task 2).
2. `at` falls exactly on a closing or opening minute, or between the morning and afternoon sessions: closed on the closing minute, open on the opening minute (Task 2).
3. Locality typed with accents, case or stray spaces (`" río cuarto "`, `"Cordoba"`): resolves; an unknown one lists valid localities (Task 7).
4. A locality with no active alert: a normal answer ("0 active alerts") that still carries the disclaimer, not an error (Task 8).
5. Odd request paths: `/casa-gigli/mcp/`, `/CASA-GIGLI/mcp`, `/a/b/mcp`, `/guemes` and `GET /guemes/mcp` — 404, 404, 404, 404, 405 (Task 3).
6. A tyre search that matches nothing, or a size with another spacing: `0 match(es)` as a normal answer, and the same hit for every spacing (Task 5).

## File Structure

| Path | Responsibility |
|---|---|
| `src/data.ts` (create) | `dataFile(tenant, name)` and `loadJson(schema, file)`: locate and validate a tenant data file |
| `src/business-info.ts` (create) | Business-info schema, `parseAt`, `isOpenAt`, `registerBusinessInfoTool` (shared by all tenants) |
| `src/tenant.ts` (create) | `Tenant` interface |
| `src/registry.ts` (create) | `createTenants`, `DEFAULT_TENANT` |
| `src/tools.ts` (modify) | Split out `registerCatalogTools`; `createCatalogServer` keeps working |
| `src/http.ts`, `src/main.ts` (modify) | Route by slug; build the registry |
| `src/tenants/casa-gigli.ts` (create) | Casa Gigli tenant: catalog tools + business info + tips/offers |
| `src/tenants/guemes/{tyres,tools,index}.ts` (create) | Güemes tenant |
| `src/tenants/ohmc/{weather,tools,index}.ts` (create) | OHMC tenant |
| `data/<slug>/…` | Per-tenant JSON (Casa Gigli's moves from `data/`) |

---

### Task 1: Move Casa Gigli's data under `data/casa-gigli/`

**Files:**
- Move: `data/catalog.json`, `data/source-catalog.psv`, `data/image-sources.json` → `data/casa-gigli/`
- Modify: every reference found by `grep -rn "data/\|\.\./data" src scripts README.md package.json` (at least `src/catalog.ts` `loadCatalog` default, `scripts/build-catalog.ts`, `scripts/check-images.ts`, `src/catalog-data.test.ts`, `src/images.test.ts`, `src/catalog.test.ts`, README)

**Interfaces:**
- Produces: data under `data/casa-gigli/`; `loadCatalog()` default file is `data/casa-gigli/catalog.json`.

- [ ] **Step 1: Create the working branch in its own worktree** (never edit `main`):
  `git -C <repo> worktree add ~/src/2wt/multi-tenant-mcp -b feat/multi-tenant-mcp origin/main`, then `cd ~/src/2wt/multi-tenant-mcp && npm ci`. Run `git branch --show-current` before every commit.
- [ ] **Step 2: Run the baseline.** Run `cd ~/src/2wt/multi-tenant-mcp && npm test && npm run typecheck`. Expected: 58 tests pass, typecheck clean. (If the count differs, record the real number; it is the bar for the rest of the plan.)
- [ ] **Step 3: `git mv` the three files and update every path reference** listed above. `assets/images/` does not move.
- [ ] **Step 4: Re-run `npm test && npm run typecheck && npm run build:catalog && git status --short`.** Expected: same pass count; `build:catalog` rewrites `data/casa-gigli/catalog.json` and `data/casa-gigli/image-sources.json` with no diff (`git diff --stat` empty for them).
- [ ] **Step 5: Commit** (`COMMIT`: "refactor: move Casa Gigli data under data/casa-gigli").

### Task 2: Shared business info and opening hours

**Files:**
- Create: `src/data.ts`, `src/business-info.ts`, `src/business-info.test.ts`

**Interfaces:**
- Produces (`src/data.ts`): `dataFile(tenant: string, name: string): URL` (resolves `../data/<tenant>/<name>` from `src/`); `loadJson<T>(schema: z.ZodType<T>, file: URL): T` (parses and validates, throws with the file name on failure).
- Produces (`src/business-info.ts`):
  - `BusinessInfoSchema` / `type BusinessInfo = { name: string; address: string; phone: string | null; email: string | null; hours: { day: 'mon'|'tue'|'wed'|'thu'|'fri'|'sat'|'sun'; ranges: { open: string; close: string }[] }[] | null; links: Record<string, string>; notes: string[] }` — `open`/`close` are `HH:MM`; `hours` is `null` when the business publishes none; when present it has exactly 7 entries (empty `ranges` = closed that day).
  - `BUSINESS_TIME_ZONE = 'America/Argentina/Cordoba'`
  - `parseAt(at: string): Date` — ISO date-time; no offset means Córdoba local time; throws `Error` whose message contains `ISO 8601` for anything unparseable.
  - `isOpenAt(info: BusinessInfo, at: Date): boolean | null` — `null` when `info.hours === null`.
  - `registerBusinessInfoTool(server: McpServer, info: BusinessInfo): void` — tool `get_business_info`, input `{ at?: string }`, `structuredContent` = the info fields plus `open_now: boolean | null` and `checked_at: string | null` (`null` when `at` is absent; then `open_now` is `null` too). Bad `at` → `isError` result via the same `failure` shape `tools.ts` uses.
- Consumes: none.

- [ ] **Step 1: Write failing tests** in `src/business-info.test.ts` using an inline `BusinessInfo` fixture equal to Casa Gigli's real hours (Mon–Fri 08:00–12:00 and 16:30–20:30, Sat 08:30–12:30, Sun closed). 2026-10-23 is a Friday. Tests (names exact):
  - `isOpenAt is true on Friday 10:00 Córdoba time` — `parseAt('2026-10-23T10:00:00')`.
  - `isOpenAt is false between sessions on Friday 13:00` and `true at 16:30`, `false at 12:00` (closing minute), `true at 08:00` (opening minute), `false at 20:30`.
  - `isOpenAt is true on Saturday 09:00 and false on Saturday 13:00`; `false on Sunday 10:00`.
  - `an offset is honoured` — `'2026-10-23T13:00:00Z'` is 10:00 in Córdoba → open.
  - `a date just past UTC midnight uses the Córdoba day` — `'2026-10-24T01:00:00Z'` is Friday 22:00 local → closed, and `'2026-10-24T12:00:00Z'` is Saturday 09:00 local → open.
  - `isOpenAt is null when hours are unpublished`.
  - `parseAt rejects garbage` — `'mañana'` and `'2026-13-45T99:00:00'` both throw an error containing `ISO 8601`. *(Review Focus 1)*
  - `get_business_info answers open_now only when at is given` and `reports an isError result naming ISO 8601 for a bad at` (connect through `InMemoryTransport`, as `tools.test.ts` does).
- [ ] **Step 2: Run `npm test -- src/business-info.test.ts`.** Expected: FAIL, module not found.
- [ ] **Step 3: Implement the interfaces above.** Use `Intl.DateTimeFormat` with `timeZone: BUSINESS_TIME_ZONE` to get weekday and `HH:MM`; compare minutes since midnight with `open <= t < close`. Append `-03:00` to an `at` that has no offset before `new Date(...)`. Spanish text is not needed; tool text lines look like `Mon 08:00-12:00, 16:30-20:30`.
- [ ] **Step 4: Run `npm test && npm run typecheck`.** Expected: all pass.
- [ ] **Step 5: Commit** (`COMMIT`: "feat: shared business info tool with opening hours").

### Task 3: Tenant registry and slug routing

**Files:**
- Create: `src/tenant.ts`, `src/registry.ts`, `src/tenants/casa-gigli.ts`
- Modify: `src/tools.ts`, `src/http.ts`, `src/main.ts`, `src/http.test.ts`

**Interfaces:**
- Produces: `interface Tenant { slug: string; name: string; createServer(): McpServer }`.
- Produces (`src/tools.ts`): `registerCatalogTools(server: McpServer, catalog: Catalog, options: ServerOptions): void` (the body of today's `createCatalogServer` after the `McpServer` is constructed); `createCatalogServer` calls it and is otherwise unchanged.
- Produces (`src/registry.ts`): `DEFAULT_TENANT = 'casa-gigli'`; `createTenants(options: { imageBaseUrl: string }): ReadonlyMap<string, Tenant>` (only Casa Gigli for now).
- Produces (`src/tenants/casa-gigli.ts`): `createCasaGigliTenant(options: ServerOptions): Tenant`.
- Changes: `HttpOptions` becomes `{ tenants: ReadonlyMap<string, Tenant>; defaultTenant?: string; authToken?: string }` (`catalog` and `imageBaseUrl` leave it).

- [ ] **Step 1: Write failing tests** in `src/http.test.ts`, replacing `start()` so it builds the server from a tenants map. Add a helper that builds two **fake tenants** (`alpha` with a tool `only_alpha`, `beta` with `only_beta`, each a tiny `McpServer`) to test routing independent of real data. Add:
  - `routes /alpha/mcp and /beta/mcp to their own tool lists` — `tools/list` through `StreamableHTTPClientTransport` on each path returns exactly that tenant's tool.
  - `calling another tenant's tool fails` — `only_beta` on `/alpha/mcp` → error.
  - `/mcp answers as the default tenant` — with `defaultTenant: 'alpha'`, `tools/list` on `/mcp` equals alpha's.
  - `unknown or odd paths` (table-driven): `/gamma/mcp`, `/alpha/mcp/`, `/ALPHA/mcp`, `/a/b/mcp`, `/alpha` → 404 with `{"error":"not_found"}`; `GET /alpha/mcp` → 405 with `Allow: POST`. *(Review Focus 5)*
  - `auth applies to every tenant route` — with a token set, `/alpha/mcp` and `/mcp` without it → 401; `/health` stays open.
  - Keep the existing body-size, invalid-JSON and auth tests, pointed at `/alpha/mcp`.
- [ ] **Step 2: Run `npm test -- src/http.test.ts`.** Expected: FAIL (type errors / 404s).
- [ ] **Step 3: Implement.** In `http.ts` resolve the tenant right after `/health`: pathname `/mcp` → `defaultTenant`; `^/([a-z0-9-]+)/mcp$` → that slug (case-sensitive); anything else, or a slug not in the map → 404. Then the existing 405 → auth → body → per-request server flow, building the server with `tenant.createServer()`. `casa-gigli.ts` loads `data/casa-gigli/catalog.json` once via `loadCatalog()` and returns a tenant whose `createServer()` makes a fresh `McpServer({ name: 'erp-mock-mcp', version: '0.1.0' })` and calls `registerCatalogTools`. `main.ts` builds `createTenants({ imageBaseUrl })` and logs the slugs.
- [ ] **Step 4: Run `npm test && npm run typecheck`, then `PORT=8799 npm start &` and `curl -s -X POST localhost:8799/casa-gigli/mcp -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'`; stop the server.** Expected: tests pass; the curl lists `search_products`, `get_product`, `list_categories`.
- [ ] **Step 5: Commit** (`COMMIT`: "feat: route MCP requests by tenant slug").

### Task 4: Casa Gigli business info, tips and offers

**Files:**
- Create: `data/casa-gigli/business.json`, `data/casa-gigli/tips.json`, `src/tenants/casa-gigli.test.ts`
- Modify: `src/tenants/casa-gigli.ts`

**Interfaces:**
- Consumes: `registerBusinessInfoTool`, `loadJson`, `dataFile`.
- Produces: tool `get_tips_and_offers`, input `{ kind?: 'tips' | 'offers' }`, `structuredContent` `{ tips: {id,topic,title,text}[]; offers: {id,title,text,valid_text}[] }` (the unrequested kind is an empty array).

- [ ] **Step 1: Write failing tests** in `src/tenants/casa-gigli.test.ts` (connect via `InMemoryTransport` to `createCasaGigliTenant({ imageBaseUrl: 'https://img.example/m' }).createServer()`):
  - `offers exactly five tools` — `['get_business_info','get_product','get_tips_and_offers','list_categories','search_products']`.
  - `business info carries the real contact data` — address `Héroes de Malvinas 271, X2563 Noetinger, Córdoba`, phone `03472 47-0066`, links include `https://www.instagram.com/casa_gigli` and `https://casagigli.com.ar/`.
  - `is open Friday 10:00 and closed Sunday 10:00` for `at` `2026-10-23T10:00:00` / `2026-10-25T10:00:00`.
  - `kind offers returns only offers` and `without kind returns both`; at least 3 tips and 3 offers in the data.
  - `the three catalog tools answer as before` — `search_products {query:'bicicleta'}` still returns `total_matches` ≥ 1 with the existing shape.
- [ ] **Step 2: Run `npm test -- src/tenants/casa-gigli.test.ts`.** Expected: FAIL.
- [ ] **Step 3: Write the data and register the tools.** `business.json` holds the owner's real data from the spec (Mon–Fri 08:00–12:00 and 16:30–20:30, Sat 08:30–12:30, Sun closed). `tips.json` holds invented tips (for example: how to size a bicycle, caring for a mattress) and offers that fit the catalog's cash-versus-24-instalments model, with a `valid_text` such as `"Hasta agotar stock"` and no computed dates. `casa-gigli.ts` registers `get_business_info` and `get_tips_and_offers` next to the catalog tools; the description tells the model offers are only what the tool returns.
- [ ] **Step 4: Run `npm test && npm run typecheck`.** Expected: all pass.
- [ ] **Step 5: Commit** (`COMMIT`: "feat: Casa Gigli business info, tips and offers").

### Task 5: Güemes tyre catalog and tools

**Files:**
- Create: `data/guemes/business.json`, `data/guemes/tyres.json`, `src/tenants/guemes/tyres.ts`, `src/tenants/guemes/tools.ts`, `src/tenants/guemes/index.ts`, `src/tenants/guemes/tyres.test.ts`, `src/tenants/guemes/tools.test.ts`
- Modify: `src/registry.ts`

**Interfaces:**
- Consumes: `normalise`, `tokenise` (`src/text.ts`); `registerBusinessInfoTool`; `loadJson`, `dataFile`.
- Produces (`tyres.ts`): `VEHICLE_TYPES = ['auto','camioneta','moto'] as const`; `TyreSchema` / `type Tyre = { id: string; sku: string; brand: string; model: string; size: string; vehicle_type: VehicleType; list_price: number; cash_price: number; note: string | null }` (integer ARS); `sizeKey(size: string): string` (digits only); `searchTyres(tyres: readonly Tyre[], o: { query?: string; size?: string; brand?: string; vehicleType?: VehicleType; minPrice?: number; maxPrice?: number; limit?: number }): { totalMatches: number; tyres: Tyre[] }` (cash price ascending, ties by id, default limit 5, max 20); `findTyre(tyres, key: string): Tyre | undefined` (id or sku, case-insensitive).
- Produces (`index.ts`): `createGuemesTenant(): Tenant`, tools `get_business_info`, `search_products` (`query`, `size`, `brand`, `category` = a vehicle type, `min_price`, `max_price`, `limit`), `get_product` (`sku`), `list_categories` (vehicle types with counts).

- [ ] **Step 1: Write failing tests.**
  - `tyres.test.ts`: `sizeKey equals for '205/55 R16', '205/55R16', '205/55r16'` and differs for `'205/60 R16'` and `'205/55 R17'`; `searchTyres with size 205/55R16 finds every product of that size, whatever the spacing` (data has ≥ 2 such, different brands); `a brand filter ignores case and accents`; `results are cheapest first`; `a search matching nothing returns totalMatches 0` *(Review Focus 6)*; `price filters apply to cash_price`.
  - `tools.test.ts`: `offers exactly four tools` (`get_business_info`, `get_product`, `list_categories`, `search_products`); `business info has the real contact data` (address `Julio A. Roca 987, X5000CQG Córdoba`, phone `0351 460-3165`, Facebook link) and open Friday `2026-10-23T09:00:00`, closed `2026-10-24T09:00:00` (Saturday) and at `18:00` Friday; `unknown category is an isError result listing auto, camioneta, moto` (assert the three valid values appear); `get_product of an unknown sku suggests near ids`; `list_categories counts add up to the catalog size`.
  - Data guard (in `tyres.test.ts`): `the dataset has 15 tyres, unique ids and skus, cash_price <= list_price`, with at least 3 vehicle types present.
- [ ] **Step 2: Run `npm test -- src/tenants/guemes`.** Expected: FAIL.
- [ ] **Step 3: Write the data and implement.** `tyres.json`: 15 invented tyres (real brand names are fine, prices invented, ARS) across the three vehicle types, including two brands with `205/55 R16`; ids like `GN-001`. `business.json` per the spec's real data (Mon–Fri 08:30–18:00; Sat and Sun empty `ranges`; link `facebook`). Tool descriptions tell the model prices are fixed demo prices, never to quote one not returned, and that `size` accepts `205/55 R16` in any spacing. Register the tenant in `createTenants`.
- [ ] **Step 4: Run `npm test && npm run typecheck`.** Expected: all pass.
- [ ] **Step 5: Commit** (`COMMIT`: "feat: Güemes Neumáticos tenant with tyre catalog").

### Task 6: Güemes services and maintenance tips

**Files:**
- Create: `data/guemes/services.json`, `data/guemes/tips.json`
- Modify: `src/tenants/guemes/tools.ts`, `src/tenants/guemes/index.ts`, `src/tenants/guemes/tools.test.ts`

**Interfaces:**
- Produces: tool `list_services` (no input) → `{ services: { id: string; name: string; description: string; from_price: number; unit: string; duration_minutes: number; includes: string[] }[] }`; tool `get_maintenance_tips` (`topic?: string`) → `{ tips: { id: string; topic: string; title: string; text: string }[] }`; topic matching ignores case and accents, an unknown topic is an `isError` result listing the valid topics.

- [ ] **Step 1: Write failing tests** in `tools.test.ts`: tool list now has six names (add `list_services`, `get_maintenance_tips`); `list_services includes balanceo, amortiguadores and rotación` (match on normalised names; prices are positive integers); `tips include a rotation tip mentioning 10.000 km` (assert the text contains `10.000 km`, which is how the data must write it) `and a pressure tip`; `topic 'presion' (no accent) finds the pressure tips`; `unknown topic is an isError listing valid topics`.
- [ ] **Step 2: Run `npm test -- src/tenants/guemes/tools.test.ts`.** Expected: FAIL.
- [ ] **Step 3: Write data and register the tools.** Services (invented prices): wheel balancing, shock-absorber replacement, tyre rotation, plus alignment and tyre fitting. Tips (Spanish): rotate every 10.000 km, check pressure monthly with cold tyres, tread depth, spare tyre, signs a shock absorber needs replacing. Descriptions say `from_price` is a starting price and not a quote.
- [ ] **Step 4: Run `npm test && npm run typecheck`.** Expected: all pass.
- [ ] **Step 5: Commit** (`COMMIT`: "feat: Güemes services and maintenance tips").

### Task 7: OHMC localities and forecast

**Files:**
- Create: `data/ohmc/localities.json`, `data/ohmc/forecasts.json`, `src/tenants/ohmc/weather.ts`, `src/tenants/ohmc/tools.ts`, `src/tenants/ohmc/index.ts`, `src/tenants/ohmc/weather.test.ts`, `src/tenants/ohmc/tools.test.ts`
- Modify: `src/registry.ts`

**Interfaces:**
- Produces (`weather.ts`): `DISCLAIMER = 'Datos de demostración, no oficiales'`; `Locality = { slug: string; name: string; department: string }`; `ForecastDay = { date: string; min_c: number; max_c: number; condition: string; rain_probability_percent: number; wind_kmh: number; wind_direction: string }`; `resolveLocality(localities: readonly Locality[], input: string): Locality | undefined` (match on normalised, trimmed name or slug); `suggestLocalities(localities, input): string[]` (up to 3 names starting with the same first letters, as `didYouMean` does).
- Produces (`index.ts`): `createOhmcTenant(): Tenant`. Tools here: `list_localities` (no input) and `get_forecast` (`locality: string`, `extended?: boolean`) → `{ locality: string; reference_date: string; extended: boolean; days: ForecastDay[]; disclaimer: string }` — `days` has 1 entry (today) or 5 (extended); `forecasts.json` has one 5-day series per locality, starting at `reference_date` `2026-10-23`.
- Consumes: `loadJson`, `dataFile`.

- [ ] **Step 1: Write failing tests.**
  - `weather.test.ts`: `resolveLocality ignores case, accents and surrounding spaces` for `' río cuarto '`, `'RIO CUARTO'`, `'Cordoba'` (→ Córdoba) and `'villa-carlos-paz'` *(Review Focus 3)*; `unknown locality returns undefined`; `suggestLocalities('Villa')` returns both Villa Carlos Paz and Villa María; the dataset guard: ≥ 4 localities (Córdoba, Villa Carlos Paz, Río Cuarto, Villa María among them), each with exactly 5 forecast days, dates consecutive from `2026-10-23`, `min_c <= max_c`, rain probability 0–100.
  - `tools.test.ts`: `offers list_localities and get_forecast` (the OHMC list grows in Task 8); `get_forecast defaults to today` (1 day dated 2026-10-23); `extended returns 5 days`; `every answer carries the disclaimer in text and structuredContent`; `unknown locality is an isError result that lists valid localities`.
- [ ] **Step 2: Run `npm test -- src/tenants/ohmc`.** Expected: FAIL.
- [ ] **Step 3: Write the data and implement.** Invented forecasts with believable October values for central Córdoba (the builder chooses the numbers). Register the tenant in `createTenants`. Descriptions tell the model the data is a demo and to mention it when asked how reliable the forecast is.
- [ ] **Step 4: Run `npm test && npm run typecheck`.** Expected: all pass.
- [ ] **Step 5: Commit** (`COMMIT`: "feat: OHMC tenant with localities and forecast").

### Task 8: OHMC alerts, conditions, hydrology, business info and links

**Files:**
- Create: `data/ohmc/alerts.json`, `data/ohmc/conditions.json`, `data/ohmc/hydrology.json`, `data/ohmc/business.json`, `data/ohmc/links.json`
- Modify: `src/tenants/ohmc/tools.ts`, `src/tenants/ohmc/index.ts`, `src/tenants/ohmc/tools.test.ts`

**Interfaces:**
- Produces: `get_active_alerts` (`locality?: string`) → `{ alerts: { id: string; level: 'amarillo' | 'naranja' | 'rojo'; type: string; localities: string[]; validity_text: string; description: string; recommended_action: string }[]; disclaimer: string }`; `get_current_conditions` (`locality: string`) → `{ locality; observed_at: string; temperature_c: number; humidity_percent: number; pressure_hpa: number; wind_kmh: number; wind_direction: string; disclaimer }` (`observed_at` is a fixed string from the data); `get_hydrological_levels` (`locality?: string`) → `{ stations: { name: string; kind: 'river' | 'dam'; locality: string; level_m: number | null; capacity_percent: number | null; trend: 'rising' | 'steady' | 'falling' }[]; disclaimer }`; `get_business_info` via `registerBusinessInfoTool` (`hours: null`); `get_monitoring_links` (no input) → `{ links: { name: string; url: string; description: string }[] }`.
- Data from the site (read 2026-10-23): address `Ituzaingó 1300, Parque de las Tejas, Córdoba`, email `info@ohmc.ar`, links to Facebook, X, Instagram, YouTube; `notes` mention the COSECHEROS extreme-event reporting programme; `links.json` points to the real sources the site names (SMN, REPROMMAT, APRHi, the WRF model page, radar) with URLs taken from `https://ohmc.ar/` itself, not guessed.

- [ ] **Step 1: Write failing tests** in `tools.test.ts`: tool list is exactly `get_active_alerts, get_business_info, get_current_conditions, get_forecast, get_hydrological_levels, get_monitoring_links, list_localities`; `with no locality returns all alerts` (≥ 1, ≤ 2 in the data); `an alert for Villa Carlos Paz is returned for that locality and not for Río Cuarto`; `a locality with no alert returns 0 alerts, not an error, and still carries the disclaimer` *(Review Focus 4)*; `unknown locality is an isError result for conditions, alerts and hydrology`; `business info has address, email and open_now null even when at is given`; `hydrology without a locality returns at least one river and one dam`; `every weather tool's text contains 'no oficiales'`; every link `url` starts with `https://`.
- [ ] **Step 2: Run `npm test -- src/tenants/ohmc/tools.test.ts`.** Expected: FAIL.
- [ ] **Step 3: Write data and register the tools.** Fetch `https://ohmc.ar/` once (WebFetch) to copy the real link URLs; if a URL cannot be confirmed, leave that link out. Alerts are invented (for example a storm and heavy-rain alert for the sierras) with a recommended action each.
- [ ] **Step 4: Run `npm test && npm run typecheck`.** Expected: all pass.
- [ ] **Step 5: Commit** (`COMMIT`: "feat: OHMC alerts, conditions, hydrology and links").

### Task 9: Isolation test, README and end-to-end smoke

**Files:**
- Create: `src/registry.test.ts`
- Modify: `README.md`, `package.json` (only if a test-count or script text changes)

**Interfaces:**
- Consumes: `createTenants`, `DEFAULT_TENANT`, `createHttpServer`.

- [ ] **Step 1: Write the failing test** `src/registry.test.ts`: `registers exactly casa-gigli, guemes and ohmc`; `tools/list over HTTP on each real route returns exactly that tenant's tools and no other tenant's` (assert the three sets are pairwise disjoint except the shared `get_business_info`, `search_products`, `get_product`, `list_categories` names, and that `get_forecast` is only on `/ohmc/mcp`, `list_services` only on `/guemes/mcp`, `get_tips_and_offers` only on `/casa-gigli/mcp`); `/mcp lists the same tools as /casa-gigli/mcp`.
- [ ] **Step 2: Run `npm test -- src/registry.test.ts`.** Expected: FAIL only if a tenant leaks or is missing; if it passes at once, break isolation on purpose (register `get_forecast` on Güemes), watch it fail, restore.
- [ ] **Step 3: Update `README.md`:** the routes table, the tools per tenant, the "invented data" warning for Güemes and OHMC, the real-data provenance, how to register each tenant in Textra (`https://<public-host>/<slug>/mcp`), and the `at` parameter. Update the test count with `npm test` output.
- [ ] **Step 4: Smoke run.** Run `npm test && npm run typecheck`, then `PORT=8799 npm start &` and, for each of `/casa-gigli/mcp`, `/guemes/mcp`, `/ohmc/mcp`, `/mcp`, send `tools/list` with curl (as in Task 3) and one `tools/call` of `get_business_info`. Expected: tool sets match the README; the `/ohmc/mcp` answer says `no oficiales`; stop the server.
- [ ] **Step 5: Commit** (`COMMIT`: "docs: multi-tenant routes, tools and data provenance").

---

## Self-review notes

- Spec coverage: routes/alias/404 (3), per-tenant isolation (3, 9), Casa Gigli info/tips (4), Güemes info/products/services/tips (5, 6), OHMC forecast/alerts/extras (7, 8), `at` semantics (2), auth (3), tests (all), README (9).
- Not covered by design: per-tenant tokens and live data (non-goals).
