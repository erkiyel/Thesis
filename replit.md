# Oncophil Pharmaceutical Management System

Secure pharmaceutical management foundation for Oncophil, with Supabase authentication and role-specific admin and client workspaces.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 8080)
- `pnpm --filter @workspace/oncophil-system run dev` — run the Oncophil web app
- `pnpm --filter @workspace/oncophil-system run typecheck` — typecheck the web app
- `PORT=4178 BASE_PATH=/ pnpm --filter @workspace/oncophil-system run build` — production build check
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- Required environment variables in Replit Secrets:
  - `NEXT_PUBLIC_SUPABASE_URL`
  - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
  - `SUPABASE_SERVICE_ROLE_KEY` — server-only; never expose it to the frontend

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- Frontend: React + Vite + TypeScript
- Authentication and database: Supabase
- Deployment target: Vercel
- UI: Tailwind CSS and shared Radix UI primitives

## Development methodology

- Waterfall / Linear Sequential Model
- Complete each approved phase before beginning the next phase.
- Phase 1.5 contains admin-created client accounts and password recovery.

## Where things live

- `artifacts/oncophil-system/` — Oncophil web application
- `artifacts/oncophil-system/src/lib/supabase.ts` — Supabase client, session, and profile-role loading
- `artifacts/oncophil-system/src/hooks/use-auth.tsx` — authentication context and session lifecycle
- `artifacts/oncophil-system/src/pages/login.tsx` — login screen
- `artifacts/oncophil-system/src/pages/user-management.tsx` — protected admin client-account management
- `artifacts/oncophil-system/src/pages/forgot-password.tsx` — password recovery request
- `artifacts/oncophil-system/src/pages/reset-password.tsx` — password reset form and invalid-link handling
- `artifacts/oncophil-system/src/pages/foundation.tsx` — protected Phase 1 admin/client pages
- `artifacts/oncophil-system/src/components/app-shell.tsx` — role-specific sidebar shell
- `artifacts/api-server/src/routes/admin-users.ts` — protected admin client-account API
- `artifacts/api-server/src/lib/supabase-admin.ts` — server-only Supabase Admin API integration
- `lib/api-spec/openapi.yaml` — shared API contract

## Architecture decisions

- Supabase Auth is the source of truth for authentication sessions.
- The existing Supabase `profiles` table is the source of truth for `admin` and `client` roles; Auth metadata is not used to authorize a workspace.
- Supabase persists and refreshes sessions; the client does not implement local password storage, JWT handling, or a parallel session system.
- Phase 1 and Phase 1.5 use protected role-specific routes and intentionally leave business modules unavailable.
- Client account creation uses the API server and Supabase Admin API; the browser never receives a service-role credential.
- Forecasting eligibility remains configurable until the thesis methodology defines valid historical sales.

## Product

Phase 1.5 provides secure login/logout, session restoration, role-aware routing, profile identity display, separate admin/client foundation workspaces, admin-created client accounts, client account viewing, forgot-password email requests, and password reset. Inventory, orders, payments, tracking, archives, and Linear Regression forecasting are reserved for later Waterfall phases.

## User preferences

- Keep the implementation understandable for a 4th-year BS Computer Science thesis.
- Do not change the approved Supabase schema or original system requirements.

## Gotchas

- Do not add inventory, ordering, payments, tracking, forecasting, or business-data dashboards during Phase 1.
- Never expose a Supabase service-role or secret key in frontend code.
- Profile rows must exist before role-protected routes can resolve an account to `admin` or `client`.
- Add the deployed app URL and the local preview URL to Supabase Auth Redirect URLs for password reset emails to return to `/reset-password`.
- Do not describe the development process as Agile; use Waterfall / Linear Sequential Model.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
