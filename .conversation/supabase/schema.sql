/*
  Oncophil Pharmaceutical Management System
  Supabase database schema

  Development methodology:
    Waterfall Model / Linear Sequential Model

  Scope:
    - Admin and client authentication profiles
    - Medicine inventory
    - Client orders and order items
    - Cash/GCash payment recording
    - Admin-entered package tracking history
    - Archived orders and purchases
    - Linear Regression forecast history

  Important forecasting note:
    This schema intentionally does not decide which transactions are valid
    historical sales. That rule remains configurable until the thesis
    methodology defines it. The forecasting service must apply that rule
    when it reads orders, payments, and order_items.

  Run this migration in a Supabase project. It assumes Supabase Auth is
  enabled and that auth.users is available.
*/

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Domain types
-- ---------------------------------------------------------------------------

do $$
begin
  create type public.user_role as enum ('admin', 'client');
exception
  when duplicate_object then null;
end
$$;

do $$
begin
  create type public.order_status as enum (
    'pending',
    'processing',
    'shipped',
    'out_for_delivery',
    'delivered',
    'cancelled'
  );
exception
  when duplicate_object then null;
end
$$;

do $$
begin
  create type public.payment_method as enum ('gcash', 'cash');
exception
  when duplicate_object then null;
end
$$;

do $$
begin
  create type public.payment_status as enum ('unpaid', 'paid');
exception
  when duplicate_object then null;
end
$$;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  avatar_url text not null,
  role public.user_role not null default 'client',
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.medicines (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  image_url text not null,
  price numeric(12, 2) not null check (price >= 0),
  stock_quantity integer not null check (stock_quantity >= 0),
  is_available boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.profiles(id) on delete restrict,
  order_status public.order_status not null default 'pending',
  total_amount numeric(12, 2) not null check (total_amount >= 0),
  current_location text,
  estimated_delivery_at timestamptz,
  archived_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete restrict,
  medicine_id uuid not null references public.medicines(id) on delete restrict,
  quantity integer not null check (quantity > 0),
  unit_price numeric(12, 2) not null check (unit_price >= 0),
  unique (order_id, medicine_id)
);

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references public.orders(id) on delete restrict,
  payment_method public.payment_method not null,
  payment_status public.payment_status not null default 'unpaid',
  paid_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint paid_at_required_when_paid
    check (
      (payment_status = 'paid' and paid_at is not null)
      or (payment_status = 'unpaid' and paid_at is null)
    )
);

create table if not exists public.order_tracking_events (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete restrict,
  status public.order_status not null,
  location text not null,
  notes text,
  estimated_delivery_at timestamptz,
  event_time timestamptz not null default timezone('utc', now()),
  recorded_by uuid not null references public.profiles(id) on delete restrict
);

create table if not exists public.forecast_runs (
  id uuid primary key default gen_random_uuid(),
  generated_by uuid not null references public.profiles(id) on delete restrict,
  historical_start_date date not null,
  historical_end_date date not null,
  period_granularity text not null
    check (period_granularity in ('daily', 'weekly', 'monthly')),
  forecast_horizon integer not null check (forecast_horizon > 0),
  model_type text not null default 'linear_regression'
    check (model_type = 'linear_regression'),
  created_at timestamptz not null default timezone('utc', now()),
  constraint valid_historical_period
    check (historical_end_date >= historical_start_date)
);

create table if not exists public.forecast_results (
  id uuid primary key default gen_random_uuid(),
  forecast_run_id uuid not null references public.forecast_runs(id) on delete cascade,
  medicine_id uuid not null references public.medicines(id) on delete restrict,
  forecast_period date not null,
  predicted_quantity numeric(12, 2) not null check (predicted_quantity >= 0),
  unique (forecast_run_id, medicine_id, forecast_period)
);

-- ---------------------------------------------------------------------------
-- Updated-at trigger
-- ---------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

drop trigger if exists medicines_set_updated_at on public.medicines;
create trigger medicines_set_updated_at
before update on public.medicines
for each row execute function public.set_updated_at();

drop trigger if exists orders_set_updated_at on public.orders;
create trigger orders_set_updated_at
before update on public.orders
for each row execute function public.set_updated_at();

drop trigger if exists payments_set_updated_at on public.payments;
create trigger payments_set_updated_at
before update on public.payments
for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Role helper functions
--
-- These functions are security definer functions so RLS policies can check
-- a user's role without recursively querying the profiles policies.
-- ---------------------------------------------------------------------------

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and role = 'admin'::public.user_role
  );
$$;

create or replace function public.is_client()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and role = 'client'::public.user_role
  );
$$;

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;

revoke all on function public.is_client() from public;
grant execute on function public.is_client() to authenticated;

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------

create index if not exists orders_client_id_idx
  on public.orders (client_id);

create index if not exists orders_status_idx
  on public.orders (order_status);

create index if not exists orders_archived_at_idx
  on public.orders (archived_at);

create index if not exists order_items_order_id_idx
  on public.order_items (order_id);

create index if not exists order_items_medicine_id_idx
  on public.order_items (medicine_id);

create index if not exists payments_status_idx
  on public.payments (payment_status);

create index if not exists tracking_events_order_time_idx
  on public.order_tracking_events (order_id, event_time desc);

create index if not exists forecast_runs_created_at_idx
  on public.forecast_runs (created_at desc);

create index if not exists forecast_results_run_id_idx
  on public.forecast_results (forecast_run_id);

create index if not exists forecast_results_medicine_period_idx
  on public.forecast_results (medicine_id, forecast_period);

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.medicines enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.payments enable row level security;
alter table public.order_tracking_events enable row level security;
alter table public.forecast_runs enable row level security;
alter table public.forecast_results enable row level security;

-- Profiles

drop policy if exists profiles_select_self_or_admin on public.profiles;
create policy profiles_select_self_or_admin
on public.profiles
for select
to authenticated
using (
  id = auth.uid()
  or public.is_admin()
);

drop policy if exists profiles_insert_self_as_client on public.profiles;
create policy profiles_insert_self_as_client
on public.profiles
for insert
to authenticated
with check (
  id = auth.uid()
  and role = 'client'::public.user_role
);

-- No public profile update policy is created. Profile changes, especially
-- role changes, must be performed by protected server-side logic.

-- Medicines

drop policy if exists medicines_select_available_or_admin on public.medicines;
create policy medicines_select_available_or_admin
on public.medicines
for select
to authenticated
using (
  is_available = true
  or public.is_admin()
);

drop policy if exists medicines_insert_admin on public.medicines;
create policy medicines_insert_admin
on public.medicines
for insert
to authenticated
with check (public.is_admin());

drop policy if exists medicines_update_admin on public.medicines;
create policy medicines_update_admin
on public.medicines
for update
to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists medicines_delete_admin on public.medicines;
create policy medicines_delete_admin
on public.medicines
for delete
to authenticated
using (public.is_admin());

-- Orders

drop policy if exists orders_select_owner_or_admin on public.orders;
create policy orders_select_owner_or_admin
on public.orders
for select
to authenticated
using (
  client_id = auth.uid()
  or public.is_admin()
);

drop policy if exists orders_insert_client_or_admin on public.orders;
create policy orders_insert_client_or_admin
on public.orders
for insert
to authenticated
with check (
  public.is_admin()
  or (
    public.is_client()
    and client_id = auth.uid()
  )
);

drop policy if exists orders_update_admin on public.orders;
create policy orders_update_admin
on public.orders
for update
to authenticated
using (public.is_admin())
with check (public.is_admin());

-- Orders are archived rather than deleted. No delete policy is provided.

-- Order items

drop policy if exists order_items_select_owner_or_admin on public.order_items;
create policy order_items_select_owner_or_admin
on public.order_items
for select
to authenticated
using (
  public.is_admin()
  or exists (
    select 1
    from public.orders
    where orders.id = order_items.order_id
      and orders.client_id = auth.uid()
  )
);

drop policy if exists order_items_insert_owner_or_admin on public.order_items;
create policy order_items_insert_owner_or_admin
on public.order_items
for insert
to authenticated
with check (
  public.is_admin()
  or (
    public.is_client()
    and exists (
      select 1
      from public.orders
      where orders.id = order_items.order_id
        and orders.client_id = auth.uid()
    )
  )
);

drop policy if exists order_items_update_admin on public.order_items;
create policy order_items_update_admin
on public.order_items
for update
to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists order_items_delete_admin on public.order_items;
create policy order_items_delete_admin
on public.order_items
for delete
to authenticated
using (public.is_admin());

-- Payments

drop policy if exists payments_select_owner_or_admin on public.payments;
create policy payments_select_owner_or_admin
on public.payments
for select
to authenticated
using (
  public.is_admin()
  or exists (
    select 1
    from public.orders
    where orders.id = payments.order_id
      and orders.client_id = auth.uid()
  )
);

drop policy if exists payments_insert_owner_or_admin on public.payments;
create policy payments_insert_owner_or_admin
on public.payments
for insert
to authenticated
with check (
  public.is_admin()
  or (
    public.is_client()
    and payment_status = 'unpaid'::public.payment_status
    and exists (
      select 1
      from public.orders
      where orders.id = payments.order_id
        and orders.client_id = auth.uid()
    )
  )
);

drop policy if exists payments_update_admin on public.payments;
create policy payments_update_admin
on public.payments
for update
to authenticated
using (public.is_admin())
with check (public.is_admin());

-- Tracking history

drop policy if exists tracking_select_owner_or_admin on public.order_tracking_events;
create policy tracking_select_owner_or_admin
on public.order_tracking_events
for select
to authenticated
using (
  public.is_admin()
  or exists (
    select 1
    from public.orders
    where orders.id = order_tracking_events.order_id
      and orders.client_id = auth.uid()
  )
);

drop policy if exists tracking_insert_admin on public.order_tracking_events;
create policy tracking_insert_admin
on public.order_tracking_events
for insert
to authenticated
with check (
  public.is_admin()
  and recorded_by = auth.uid()
);

-- Tracking events are historical records. No update or delete policies are
-- provided, preserving the history after it has been recorded.

-- Forecast history

drop policy if exists forecast_runs_select_admin on public.forecast_runs;
create policy forecast_runs_select_admin
on public.forecast_runs
for select
to authenticated
using (public.is_admin());

drop policy if exists forecast_runs_insert_admin on public.forecast_runs;
create policy forecast_runs_insert_admin
on public.forecast_runs
for insert
to authenticated
with check (
  public.is_admin()
  and generated_by = auth.uid()
  and model_type = 'linear_regression'
);

drop policy if exists forecast_results_select_admin on public.forecast_results;
create policy forecast_results_select_admin
on public.forecast_results
for select
to authenticated
using (public.is_admin());

drop policy if exists forecast_results_insert_admin on public.forecast_results;
create policy forecast_results_insert_admin
on public.forecast_results
for insert
to authenticated
with check (public.is_admin());

-- Forecast runs and results are historical records. No update or delete
-- policies are provided.

-- ---------------------------------------------------------------------------
-- Supabase Storage buckets
--
-- These buckets support the required medicine and profile pictures.
-- The application stores the resulting object URLs in image_url/avatar_url.
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values
  ('medicine-images', 'medicine-images', true),
  ('profile-images', 'profile-images', true)
on conflict (id) do nothing;

drop policy if exists medicine_images_public_read on storage.objects;
create policy medicine_images_public_read
on storage.objects
for select
to public
using (bucket_id = 'medicine-images');

drop policy if exists medicine_images_admin_insert on storage.objects;
create policy medicine_images_admin_insert
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'medicine-images'
  and public.is_admin()
);

drop policy if exists medicine_images_admin_update on storage.objects;
create policy medicine_images_admin_update
on storage.objects
for update
to authenticated
using (
  bucket_id = 'medicine-images'
  and public.is_admin()
)
with check (
  bucket_id = 'medicine-images'
  and public.is_admin()
);

drop policy if exists medicine_images_admin_delete on storage.objects;
create policy medicine_images_admin_delete
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'medicine-images'
  and public.is_admin()
);

drop policy if exists profile_images_public_read on storage.objects;
create policy profile_images_public_read
on storage.objects
for select
to public
using (bucket_id = 'profile-images');

drop policy if exists profile_images_owner_insert on storage.objects;
create policy profile_images_owner_insert
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'profile-images'
  and owner_id = auth.uid()::text
);

drop policy if exists profile_images_owner_update on storage.objects;
create policy profile_images_owner_update
on storage.objects
for update
to authenticated
using (
  bucket_id = 'profile-images'
  and owner_id = auth.uid()::text
)
with check (
  bucket_id = 'profile-images'
  and owner_id = auth.uid()::text
);

drop policy if exists profile_images_owner_delete on storage.objects;
create policy profile_images_owner_delete
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'profile-images'
  and owner_id = auth.uid()::text
);