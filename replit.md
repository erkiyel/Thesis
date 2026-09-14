# Oncophil Pharmaceutical Management System

Secure pharmaceutical management foundation for Oncophil, with Supabase authentication and role-specific admin and client workspaces.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm --filter @workspace/oncophil-system run dev` — run the Oncophil web app
- `pnpm --filter @workspace/oncophil-system run typecheck` — typecheck the web app
- `PORT=4178 BASE_PATH=/ pnpm --filter @workspace/oncophil-system run build` — production build check
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- Required environment variables in Replit Secrets:
  - `NEXT_PUBLIC_SUPABASE_URL`
  - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- Frontend: React + Vite + TypeScript
- Authentication and database: Supabase
- Deployment target: Vercel
- UI: Tailwind CSS and shared Radix UI primitives

## Development methodology

- Waterfall / Linear Sequential Model
- Complete each approved phase before beginning the next phase.
- Phase 1 contains only system foundation and authentication.

## Where things live

- `artifacts/oncophil-system/` — Oncophil web application
- `artifacts/oncophil-system/src/lib/supabase.ts` — Supabase client, session, and profile-role loading
- `artifacts/oncophil-system/src/hooks/use-auth.tsx` — authentication context and session lifecycle
- `artifacts/oncophil-system/src/pages/login.tsx` — login screen
- `artifacts/oncophil-system/src/pages/foundation.tsx` — protected Phase 1 admin/client pages
- `artifacts/oncophil-system/src/components/app-shell.tsx` — role-specific sidebar shell
- `lib/api-spec/openapi.yaml` — shared API contract for future API-backed modules

## Architecture decisions

- Supabase Auth is the source of truth for authentication sessions.
- The existing Supabase `profiles` table is the source of truth for `admin` and `client` roles; Auth metadata is not used to authorize a workspace.
- Supabase persists and refreshes sessions; the client does not implement local password storage, JWT handling, or a parallel session system.
- Phase 1 uses protected role-specific routes and intentionally leaves business modules unavailable.
- Forecasting eligibility remains configurable until the thesis methodology defines valid historical sales.

## Product

Phase 1 provides secure login/logout, session restoration, role-aware routing, profile identity display, and separate admin/client foundation workspaces. Inventory, orders, payments, tracking, archives, and Linear Regression forecasting are reserved for later Waterfall phases.

## User preferences

- Keep the implementation understandable for a 4th-year BS Computer Science thesis.
- Do not change the approved Supabase schema or original system requirements.

## Gotchas

- Do not add inventory, ordering, payments, tracking, forecasting, or business-data dashboards during Phase 1.
- Never expose a Supabase service-role or secret key in frontend code.
- Profile rows must exist before role-protected routes can resolve an account to `admin` or `client`.
- Do not describe the development process as Agile; use Waterfall / Linear Sequential Model.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
