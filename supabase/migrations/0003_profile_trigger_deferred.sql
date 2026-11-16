-- The Auth admin API (createUser with app_metadata) inserts the auth.users row with only
-- provider metadata and sets app_metadata afterwards in the same transaction, so the
-- immediate AFTER INSERT trigger from 0001 never saw the username and rejected every
-- admin-created user. Make it a deferred constraint trigger that reads the final row at
-- commit. The "username is required" rule is unchanged.

drop trigger on_auth_user_created on auth.users;

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  meta jsonb;
begin
  select raw_app_meta_data into meta from auth.users where id = new.id;
  if not found then
    return null; -- user was removed again in the same transaction
  end if;
  if coalesce(meta ->> 'username', '') = '' then
    raise exception 'username is required in raw_app_meta_data';
  end if;
  insert into public.profiles (id, role, username, full_name, batch, track)
  values (
    new.id,
    coalesce(meta ->> 'role', 'student'),
    lower(meta ->> 'username'),
    meta ->> 'full_name',
    meta ->> 'batch',
    meta ->> 'track'
  );
  return null;
end;
$$;

create constraint trigger on_auth_user_created
  after insert on auth.users
  deferrable initially deferred
  for each row execute function private.handle_new_user();
