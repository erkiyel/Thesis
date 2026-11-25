# JACDASH System Audit Report

**Audit date:** 2026-11-26 (Asia/Manila)  
**Scope:** Read-only review and non-destructive local checks. No application code, database schema, production data, deployment, or Git history was changed by this audit.

## 1. Executive Summary

The deployed frontend was requesting `/api/medicines` and `/api/admin/forecasts` from `jacdash.pages.dev`, rather than the Render PHP API. Both returned HTTP 200 responses containing the Cloudflare-served SPA document (`text/html` confirmed for medicines), because the production frontend API base was unset and the app fell back to `/api`. This is the confirmed common cause of the production failures.

The Inventory ErrorBoundary is caused by the HTML string being treated as `Medicine[]`: the inventory render calls `.map()` through `classifyInventory()`, producing the captured `TypeError: t.map is not a function`. The forecast dashboard receives the same SPA response and its `runs` envelope validator reports that `runs` is missing. The production response and browser stack were captured in the later retest described below.

The local correction sets the production API origin to the existing Render PHP service, rejects successful HTML responses as API routing errors, and validates collection payloads before rendering. Local type checking, 20 frontend unit tests, Python tests, PHP syntax checks, and the production frontend build passed. Authenticated local workflow tests and Supabase schema/RLS verification remain blocked by loopback/network restrictions and lack of a local login session.

## 2. Root Cause Analysis

### Forecast API response

**Confirmed client-side failure condition:** `parseRevenueRunsResponse()` in `Frontend/src/lib/revenue-forecast-data.ts` calls `responseArray(value, 'runs', 'Forecasts API')`. It throws the reported validation message if the successful response is not an object containing an array named `runs`. `Frontend/src/pages/revenue-forecast-dashboard.tsx` invokes this parser in `refresh()` and presents the caught error in its page state. The guard is deliberate and prevents malformed data from being silently represented as an empty list.

**Local backend contract:** `Backend/php/index.php`, route `GET /admin/forecasts`, checks the manager/admin role, reads `forecast_runs` and related `forecast_results`, and responds with `['runs' => $output]`. When there are no runs it responds with `['runs' => []]`. Supabase request errors become non-2xx API errors rather than successful responses with an invalid runs field. This makes an ordinary empty database result an unlikely explanation for the reported message.

**Confirmed production root cause:** `VITE_API_BASE_URL` was not included in the deployed frontend build. `api.ts` therefore used `/api`, and the browser Network panel showed `GET https://jacdash.pages.dev/api/admin/forecasts` returning HTTP 200 with a roughly 1.5 kB response. The UI then reported that `runs` was absent. The frontend was receiving the Cloudflare Pages SPA fallback instead of the Render PHP API. The production API origin used for correction is the existing `https://thesis-9pft.onrender.com` service from the project configuration/context; this audit did not change the deployed Cloudflare environment or deploy a new build.

**Relevant local files and locations:**

- `Frontend/src/lib/revenue-forecast-data.ts` — `responseArray()` and `parseRevenueRunsResponse()`.
- `Frontend/src/pages/revenue-forecast-dashboard.tsx` — `refresh()` requests `/admin/forecasts` and parses the envelope.
- `Frontend/src/lib/api.ts` — builds the API URL from `VITE_API_BASE_URL`, adds the Supabase access token as a bearer token, parses JSON, and casts successful payloads to the requested TypeScript type without runtime validation.
- `Backend/php/index.php` — `route()` forecast history branch and final response/error handling.

### Admin Inventory ErrorBoundary

`RoutedErrorBoundary` in `Frontend/src/App.tsx` wraps the shared inventory-alert host and route tree. Its fallback can therefore appear on any route, including `/admin/inventory`, when a synchronous React render/lifecycle error occurs.

For the Inventory page, `AdminDashboardPage.refresh()` catches request failures and stores an inline error. However, the successful payload is trusted as `Medicine[]`. `AdminInventory` passes it to `classifyInventory()` and calls `.filter()`; `classifyInventory()` calls `.map()`. A successful non-array response can thus throw during render and reach the global boundary. `AdminInventoryAlertHost` also requests `/medicines`, but catches and suppresses its probe errors, so its ordinary request failure does not explain the boundary screen.

**Confirmed production root cause:** DevTools showed `GET https://jacdash.pages.dev/api/medicines` with HTTP 200 and `Content-Type: text/html; charset=utf-8`; the response body was the SPA `index.html`. The browser console showed `TypeError: t.map is not a function` at the minified inventory `useMemo` stack. The HTML payload had been accepted by the generic `apiRequest<T>()` cast and was used as a medicine array. The page request path had no runtime collection validation, so the render error reached the app-wide boundary.

### Prior `undefined.some` crash

The current local Revenue Forecast Dashboard validates the runs envelope before calling `.some()` on `availableRuns`. This removes the direct undefined-array failure path in the inspected local implementation. The deployed bundle could not be compared, so this does not prove production is serving that implementation.

## 3. API Compatibility Report

The table records local source contracts. Live status/body and Supabase compatibility are not verified unless explicitly noted.

| Module | Frontend request / expectation | Local PHP response/auth behavior | Integration result |
|---|---|---|---|
| Authentication/session | Supabase Auth session supplies a bearer token; PHP validates it with Supabase `/auth/v1/user` | Protected route calls `currentUser()`; role and approval are checked from `profiles` | Static review only; login, refresh, expiry, logout, and role tests blocked |
| Admin dashboard / forecast history | `GET /admin/forecasts` expects `{runs: array}`; imports expects `{imports: array}` | PHP returns those envelopes; forecasts require admin or manager | Unit parser tests pass; production body unavailable |
| Inventory | `GET /medicines` expects `Medicine[]`; CRUD uses `/admin/medicines` and `/admin/medicines/{id}` | PHP serializes medicine rows as a JSON array; writes require admin | Static review only; no live data/CRUD test |
| Orders | `GET /orders` expects `Order[]`; create uses `POST /orders`; admin updates use `PATCH /admin/orders/{id}` | PHP loads items, payment, and tracking and serializes an array; role checks occur in route handlers | Static review only; no order mutation performed |
| Payments and tracking | Read through order payload; tracking via `/orders/{id}/tracking`; order update carries status/payment/tracking fields | PHP uses `payments.payment_status` and `order_tracking_events.event_time` in inspected code | Static review only; no live record tested |
| Purchase history/archive | Frontend filters delivered + paid orders from `/orders` | PHP order output maps status/payment fields; archive eligibility is client-side | Unit helper tests pass; no live purchase history tested |
| Sales imports | `/admin/forecasts/imports` expects `{imports: array}`; preview/run return structured forecast payloads | PHP route requires manager/admin and uses existing import/forecast tables | Parser unit tests pass; Supabase reads/writes not executed |
| User management | `GET/POST /admin/clients`, `GET /admin/approvals`, approval action endpoint | PHP routes require administrator and combine `profiles` with Supabase Auth admin API | Static review only; no user account created or changed |

`apiRequest<T>()` is not itself a runtime schema validator. It parses the response body and returns it as `T` for any successful status. Pages that parse unknown payloads explicitly (current Revenue Forecast Dashboard) validate envelopes; pages trusting array typings can fail later during rendering if the backend returns a successful payload of the wrong shape.

## 4. Functional Testing Results

| Module | Test case | Expected result | Actual result | Status |
|---|---|---|---|---|
| Frontend | TypeScript check | No type errors | `npm run typecheck` completed successfully | PASS |
| Frontend | Unit tests | All configured unit tests pass | 20 tests passed, 0 failed, including five API-root/response guard regressions | PASS |
| Frontend | Production build | Vite emits production bundle | Build completed; Vite warned that a minified chunk exceeds 500 kB | PASS WITH WARNING |
| Forecast parser | Missing `runs` field | Controlled validation error, not fake empty data | Unit test passed | PASS |
| Forecast parser | Valid empty `runs` and `imports` arrays | Empty state accepted | Unit test passed | PASS |
| Forecast parser | Legacy optional fields | Older records still normalize | Unit test passed | PASS |
| Orders | Order status regression | Six database-supported values pass; unsupported `confirmed` rejected | 14 PHP regression assertions passed | PASS |
| Python forecasting | Existing forecast tests | Forecast suites pass | 22 tests passed | PASS |
| PHP backend | Syntax | PHP source parses | All four PHP files checked without syntax errors | PASS |
| Inventory | Load production medicines | Inventory is returned/rendered | Production `/api/medicines` returned 200 HTML (Cloudflare SPA shell); console stack confirms `.map()` crash. Local fix adds backend base URL and payload guards; deployed behavior remains unchanged until a new frontend build is published. | FAIL — CONFIRMED ROOT CAUSE |
| Inventory | Add/edit/delete/image/search/filters/alerts | Operations work and persist correctly | No mutations run; production access unavailable | NOT TESTED |
| Forecasting | Production `GET /api/admin/forecasts` | JSON envelope contains `runs: []` or a run array | Browser showed request went to Cloudflare Pages at `/api/admin/forecasts`, HTTP 200, about 1.5 kB, and the frontend reported missing `runs`; local production API base corrected. No deployment was performed. | FAIL — CONFIRMED ROOT CAUSE |
| Forecasting | Historical imports/run/history/metrics | Database-backed values match client contract | Not run to avoid modifying/overwriting saved forecast data | NOT TESTED |
| Auth | Admin/client login, refresh, expiry, logout, role protection | Existing sessions and permissions behave correctly | Static source review only; live auth/browser tests unavailable | NOT TESTED |
| Orders/payments/tracking | End-to-end workflow and stock consistency | Correct persisted records and archive state | No live orders or payments modified | NOT TESTED |
| User management | List/create/approve/authorization | Admin-only, persisted as expected | No live account operations performed | NOT TESTED |
| Local PHP API | Health and protected endpoint probe | Backend JSON health response; protected endpoints reject unauthenticated calls | PHP service started, but HTTP probes to loopback timed out/failed due this environment's socket restrictions | BLOCKED |

### Commands and evidence

- `Frontend`: `npm run typecheck` — passed.
- `Frontend`: `npm run test:unit` — 20/20 passed after adding production API URL and malformed-response regression tests.
- `Frontend`: `npm run build` — passed; large-chunk warning remains.
- `Backend/python` with `Backend/.venv/Scripts/python.exe`: `-m unittest test_forecast test_revenue_forecast` — 22/22 passed.
- `C:\xampp\php\php.exe -l` on every `Backend/php/*.php` and PHP test file — no syntax errors.
- `C:\xampp\php\php.exe Backend/php/tests/order-status.test.php` — 14 assertions passed.
- Browser DevTools against the active deployed admin session: `/api/medicines` — HTTP 200, `text/html; charset=utf-8`, Cloudflare origin, SPA `index.html` body; console `TypeError: t.map is not a function` in the inventory render stack.
- Browser DevTools against `/admin`: `/api/admin/forecasts` — same-origin request to `jacdash.pages.dev`, HTTP 200, response size approximately 1.5 kB; page validation reported missing `runs`.
- A local PHP dev server and Vite were started. PHP syntax, frontend unit/type/build checks ran, but direct HTTP requests to local loopback timed out or were denied by this environment's socket restrictions; both servers were stopped after testing.
- The earlier production hostname probe from the command environment could not resolve Render. The live browser evidence establishes the Cloudflare fallback response but does not verify the new request against Render.

## 5. Security Findings

- The frontend attaches a Supabase access token in the `Authorization: Bearer` header when a session exists. PHP validates the token against Supabase and checks account confirmation, approval, and role before protected route work.
- The PHP backend reads its server-side service-role credential from environment configuration; it is not returned from the API response. Route-level permission checks are present in the inspected sensitive handlers.
- The inspected PHP CORS code uses explicit production origins plus a restricted Vercel preview pattern and does not enable credentialed wildcard origins.
- No RLS policy or remote schema inspection was possible. The use of a service-role key bypasses RLS by design, so backend authorization must remain comprehensive; this audit did not verify every handler against an authenticated live request.
- No secrets, access tokens, or customer records were included in the report.
- No confirmed security vulnerability was demonstrated in the scope of these checks. Security status is **not fully verified** because remote policies and live authorization paths were unavailable.

## 6. Forecasting Verification

Local code includes revenue forecast run retrieval, historical import routes, a Python forecast runner, model metadata, and response normalization. Unit tests cover malformed/missing envelopes, empty lists, legacy optional fields, malformed nested arrays, and rejection of incomplete monthly data. Python unit suites pass.

No model was retrained and no saved forecast was recalculated or overwritten. XGBoost availability, saved Supabase forecast records, three-month results, current production metrics, and chart rendering against production data remain **not verified**.

## 7. Production Compatibility

- The frontend API base is selected from `VITE_API_BASE_URL`. The previously missing production value is now supplied by `Frontend/.env.production` as `https://thesis-9pft.onrender.com`. Local development remains `/api` through the Vite proxy. The Cloudflare Pages environment was not changed; it must be rebuilt/redeployed separately to take effect.
- The repository contains a PHP REST API (`Backend/php/index.php`, Dockerfile-based) and a separate Express/TypeScript server (`Backend/src/app.ts`). The Express server has only health and admin-user routes in the inspected route tree; it does not contain the PHP forecast or medicines API handlers. Its CORS origins also differ from the PHP API's production-origin allow-list. If Render is running the Express implementation rather than the root Docker/PHP service, route and CORS behavior will not match the frontend contract.
- No Render deployment configuration or live deployment metadata in the checked project files proves which implementation is running. The public host could not be queried from this environment.
- Supabase migrations, table columns, enum constraints, RLS policies, project credentials, and Python packages on Render were not inspected remotely during this audit.

## 8. Follow-up (Not Performed)

1. **High — Publish a new Cloudflare Pages build only after review.** The corrected `Frontend/.env.production` is included in the local frontend build, but this audit did not deploy it. The current production site therefore continues using the previous bundle until a deployment occurs.
2. **High — Verify Render serves the PHP implementation.** Confirm the active service runs the root Docker/PHP app and routes `/api/*` through `Backend/index.php`; the repository also contains a partial Express implementation with different route coverage.
3. **High — Retest authenticated production inventory and forecast reads after deployment.** Confirm the Network URLs point at `thesis-9pft.onrender.com`, responses are JSON, medicines are arrays, and forecast history has a `runs` array. No database writes are needed for these checks.
4. **Medium — Complete local authenticated integration testing.** Local PHP/Vite listeners started, but loopback HTTP is restricted in the execution environment and no local signed-in session was available. Re-run login, inventory load, and forecast history from a normal local browser session.
5. **Low — Reduce the frontend bundle chunk-size warning** if desired; it did not fail the build and is unrelated to these errors.

## 9. Testing Evidence

Only local, reproducible command output is reported above. No screenshot or production API response was available. The local request for `GET /api/healthz` and protected endpoint probes could not be completed because loopback socket access is restricted. The production host probe could not resolve from this environment. No external session, API token, or Supabase credential was used.

## 10. Retest and Conclusion

The live response mismatch and Inventory crash are now confirmed, and local safeguards/configuration address the observed failure. Local automated checks pass. The system is **not yet verified end-to-end locally**: local HTTP probes were blocked, a local authenticated session was unavailable, and this change has not been deployed. The Cloudflare build must consume the committed production API URL and then be retested against Render before the production pages can be considered fixed. No Supabase data/schema, authentication logic, forecasting calculations, or deployment state was changed.
