-- The PHP API already uses the server-only Supabase service_role key.
-- These grants restore table privileges for that role without changing
-- table definitions, adding policies, or disabling RLS.
GRANT USAGE ON SCHEMA public TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  public.profiles,
  public.medicines,
  public.orders,
  public.order_items,
  public.payments,
  public.order_tracking_events
TO service_role;

GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO service_role;
