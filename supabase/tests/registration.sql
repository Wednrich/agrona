-- Run with psql -v ON_ERROR_STOP=1 against a disposable migrated project.
begin;
insert into auth.users(id,email,raw_user_meta_data) values
('33333333-3333-4333-8333-333333333333','pending@test.invalid',
 '{"full_name":"Test User","country":"Казахстан","country_code":"KZ","region":"Алматы","latitude":43.24,"longitude":76.89,"location_id":"region.test","farm_name":"Test Farm"}');
do $$ begin
 if exists(select from public.profiles where id='33333333-3333-4333-8333-333333333333') then raise exception 'Profile created before confirmation'; end if;
end $$;
update auth.users set email_confirmed_at=now() where id='33333333-3333-4333-8333-333333333333';
update auth.users set email_confirmed_at=now() where id='33333333-3333-4333-8333-333333333333';
insert into auth.users(id,email,raw_user_meta_data,email_confirmed_at) values
('44444444-4444-4444-8444-444444444444','verified@test.invalid','{"full_name":"No Farm"}',now());
do $$ begin
 if not exists(select from public.profiles where id='33333333-3333-4333-8333-333333333333' and country_code='KZ' and region='Алматы' and latitude=43.24 and longitude=76.89 and location_id='region.test') then raise exception 'Confirmed location missing'; end if;
 if (select count(*) from public.farms where user_id='33333333-3333-4333-8333-333333333333') <> 1 then raise exception 'Expected exactly one farm'; end if;
 if not exists(select from public.profiles where id='44444444-4444-4444-8444-444444444444') then raise exception 'Immediate profile missing'; end if;
 if exists(select from public.farms where user_id='44444444-4444-4444-8444-444444444444') then raise exception 'Optional farm was created'; end if;
end $$;
rollback;
