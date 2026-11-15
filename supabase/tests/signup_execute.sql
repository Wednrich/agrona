-- Run on a disposable migrated database, then run registration.sql.
begin;
do $$
begin
  if has_function_privilege('anon','public.handle_signup()','execute')
     or has_function_privilege('authenticated','public.handle_signup()','execute') then
    raise exception 'Signup trigger exposed to API clients';
  end if;
  if not exists(select 1 from pg_trigger
    where tgfoid='public.handle_signup()'::regprocedure and not tgisinternal) then
    raise exception 'Registration trigger missing';
  end if;
end $$;
rollback;
