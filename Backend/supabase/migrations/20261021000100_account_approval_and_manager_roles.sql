-- Adds public-registration approval without changing existing account access.
-- Existing admin/client accounts remain approved; client remains the stored
-- compatibility role for Partnership Accounts.
begin;

alter table public.profiles
  add column if not exists approval_status text not null default 'approved',
  add column if not exists organization_name text;

do $$
declare
  role_att smallint;
  check_row record;
begin
  select attnum into role_att
  from pg_attribute
  where attrelid = 'public.profiles'::regclass and attname = 'role' and not attisdropped;

  for check_row in
    select conname
    from pg_constraint
    where conrelid = 'public.profiles'::regclass
      and contype = 'c'
      and role_att = any(conkey)
  loop
    execute format('alter table public.profiles drop constraint %I', check_row.conname);
  end loop;

  if not exists (select 1 from pg_constraint where conrelid = 'public.profiles'::regclass and conname = 'profiles_role_allowed_check') then
    alter table public.profiles
      add constraint profiles_role_allowed_check check (role in ('admin', 'client', 'manager', 'partnership_account'));
  end if;
end $$;

alter table public.profiles
  drop constraint if exists profiles_approval_status_allowed_check;
alter table public.profiles
  add constraint profiles_approval_status_allowed_check
  check (approval_status in ('pending', 'approved', 'rejected'));

create index if not exists profiles_pending_approval_idx
  on public.profiles (approval_status) where approval_status = 'pending';

-- Profile rows may be edited by their owner, but authority and approval state
-- can only be changed by the trusted server-side service role.
create or replace function public.protect_profile_authority_fields()
returns trigger
language plpgsql
security invoker
set search_path = public, auth
as $$
begin
  if coalesce(auth.role(), '') not in ('service_role', 'supabase_admin')
     and current_user not in ('postgres', 'supabase_admin') then
    if tg_op = 'INSERT' then
      raise exception 'Profiles must be created by the trusted registration service.'
        using errcode = '42501';
    end if;
    if new.role is distinct from old.role
       or new.approval_status is distinct from old.approval_status then
      raise exception 'Profile role and approval status are managed by an administrator.'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_protect_authority_fields on public.profiles;
create trigger profiles_protect_authority_fields
  before insert or update on public.profiles
  for each row execute function public.protect_profile_authority_fields();

notify pgrst, 'reload schema';
commit;
