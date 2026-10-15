-- =============================================================================
-- Function privileges (applied last, after every function exists)
--
-- Postgres grants EXECUTE to PUBLIC by default and Supabase additionally grants
-- it to anon. Lock that down: only signed-in sessions may call the public RPCs,
-- and nothing in the private schema is callable except the three identity
-- helpers that RLS policies need.
-- =============================================================================

revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;

revoke execute on all functions in schema private from public, anon, authenticated;
grant execute on function private.current_member_id()   to authenticated;
grant execute on function private.current_member_role() to authenticated;
grant execute on function private.current_vessel_ids()  to authenticated;

-- Keep future functions closed by default too.
alter default privileges for role postgres in schema public  revoke execute on functions from public, anon;
alter default privileges for role postgres in schema private revoke execute on functions from public, anon, authenticated;
