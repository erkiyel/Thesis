-- Add a revenue target without overwriting existing medicine-quantity forecasts.
-- The import table preserves uploaded source rows across Render restarts.
begin;

create table if not exists public.forecast_imports (
  id uuid primary key default gen_random_uuid(),
  uploaded_by uuid not null references public.profiles(id) on delete restrict,
  file_name text not null check (char_length(file_name) between 1 and 255),
  source_columns jsonb not null default '{}'::jsonb,
  source_records jsonb not null default '[]'::jsonb,
  forecast_records jsonb not null default '[]'::jsonb,
  raw_row_count integer not null check (raw_row_count >= 0),
  valid_row_count integer not null check (valid_row_count >= 0),
  invalid_row_count integer not null check (invalid_row_count >= 0),
  duplicate_row_count integer not null default 0 check (duplicate_row_count >= 0),
  created_at timestamptz not null default now()
);

alter table public.forecast_imports enable row level security;
grant select, insert, update, delete on table public.forecast_imports to service_role;

alter table public.forecast_runs
  add column if not exists prediction_target text not null default 'medicine_quantity',
  add column if not exists evaluation_metadata jsonb;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.forecast_runs'::regclass
      and conname = 'forecast_runs_prediction_target_check'
  ) then
    alter table public.forecast_runs
      add constraint forecast_runs_prediction_target_check
      check (prediction_target in ('medicine_quantity', 'monthly_sales_revenue_php'));
  end if;
end $$;

alter table public.forecast_results
  alter column predicted_quantity drop not null;

alter table public.forecast_results
  add column if not exists predicted_revenue numeric(14, 2);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.forecast_results'::regclass
      and conname = 'forecast_results_predicted_revenue_nonnegative_check'
  ) then
    alter table public.forecast_results
      add constraint forecast_results_predicted_revenue_nonnegative_check
      check (predicted_revenue is null or predicted_revenue >= 0);
  end if;
end $$;

notify pgrst, 'reload schema';
commit;
