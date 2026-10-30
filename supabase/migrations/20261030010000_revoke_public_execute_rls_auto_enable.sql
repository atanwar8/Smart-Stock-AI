-- Supabase's security advisor flagged public.rls_auto_enable(), a SECURITY DEFINER function, as callable by the
-- anon and authenticated roles through /rest/v1/rpc. It is the function behind Supabase's `ensure_rls` event
-- trigger (turns RLS on for every new table), which keeps working: event triggers run regardless of EXECUTE
-- grants. Only postgres and service_role keep EXECUTE. Applied 2026-10-30 at the user's request.

revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
