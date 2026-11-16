-- revoke_user_sessions (0011, pgTAP): ends every session of one user; service role only. Run: npm run db:test
begin;
select plan(9);

insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-0000000011a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'rs-anna@students.test', '{"role":"student","username":"rs.anna"}', '{}', now(), now()),
  ('00000000-0000-0000-0000-0000000011a2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'rs-ben@students.test', '{"role":"student","username":"rs.ben"}', '{}', now(), now());

insert into auth.sessions (id, user_id, created_at, updated_at)
values
  ('00000000-0000-0000-0000-0000000011b1', '00000000-0000-0000-0000-0000000011a1', now(), now()),
  ('00000000-0000-0000-0000-0000000011b2', '00000000-0000-0000-0000-0000000011a1', now(), now()),
  ('00000000-0000-0000-0000-0000000011b3', '00000000-0000-0000-0000-0000000011a2', now(), now());
insert into auth.refresh_tokens (token, user_id, session_id, revoked, created_at, updated_at)
values ('rs-token-1', '00000000-0000-0000-0000-0000000011a1', '00000000-0000-0000-0000-0000000011b1', false, now(), now());

select ok(
  (select prosecdef from pg_proc where oid = 'public.revoke_user_sessions(uuid)'::regprocedure),
  'revoke_user_sessions is security definer'
);
select ok(not has_function_privilege('anon', 'public.revoke_user_sessions(uuid)', 'execute'), 'anon cannot execute revoke_user_sessions');
select ok(not has_function_privilege('authenticated', 'public.revoke_user_sessions(uuid)', 'execute'), 'authenticated cannot execute revoke_user_sessions');
select ok(has_function_privilege('service_role', 'public.revoke_user_sessions(uuid)', 'execute'), 'service_role can execute revoke_user_sessions');

-- An authenticated caller is refused by the privilege check.
set local role authenticated;
select throws_ok(
  $$ select public.revoke_user_sessions('00000000-0000-0000-0000-0000000011a1') $$,
  '42501', null, 'authenticated call is refused'
);
reset role;

set local role service_role;
select is(public.revoke_user_sessions('00000000-0000-0000-0000-0000000011a1'), 2, 'returns the number of sessions ended');
reset role;

select is((select count(*)::int from auth.sessions where user_id = '00000000-0000-0000-0000-0000000011a1'), 0, 'all sessions of the user are gone');
select is((select count(*)::int from auth.refresh_tokens where session_id = '00000000-0000-0000-0000-0000000011b1'), 0, 'their refresh tokens are gone');
select is((select count(*)::int from auth.sessions where user_id = '00000000-0000-0000-0000-0000000011a2'), 1, 'other users keep their sessions');

select * from finish();
rollback;
