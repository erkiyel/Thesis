-- Historical forecast products do not always have an inventory row.
-- Preserve the optional inventory link for current products and store the
-- historical product name on every forecast result.
begin;

alter table public.forecast_results
  alter column medicine_id drop not null;

alter table public.forecast_results
  add column if not exists medicine_name text;

-- Tell PostgREST to refresh its cached table definition after this migration.
notify pgrst, 'reload schema';

commit;
