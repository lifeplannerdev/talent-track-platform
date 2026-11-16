-- Ends every session of one user (staff password reset, Task 8 review). Refresh tokens are removed
-- by the ON DELETE CASCADE from auth.refresh_tokens.session_id to auth.sessions. Some Auth server
-- versions already do this on an admin password change; the app calls it explicitly so the
-- behaviour does not depend on the Auth version. Service role only.

create function public.revoke_user_sessions(p_user_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  delete from auth.sessions where user_id = p_user_id;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.revoke_user_sessions(uuid) from public, anon, authenticated;
grant execute on function public.revoke_user_sessions(uuid) to service_role;
