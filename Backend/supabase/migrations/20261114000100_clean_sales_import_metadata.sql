-- Additive support for auditable cleaned-sales workbook imports.
-- Existing import and forecasting records remain unchanged.
begin;

alter table public.forecast_imports
  add column if not exists transaction_records jsonb not null default '[]'::jsonb,
  add column if not exists monthly_revenue_records jsonb not null default '[]'::jsonb,
  add column if not exists source_sha256 text;

create unique index if not exists forecast_imports_uploader_source_sha256_key
  on public.forecast_imports (uploaded_by, source_sha256)
  where source_sha256 is not null;

notify pgrst, 'reload schema';
commit;
