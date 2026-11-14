-- Execute with psql against a disposable local Supabase database after migrations.
-- Transaction rolls back fixtures. Any failed assertion aborts execution.
begin;
insert into auth.users(id,email,raw_user_meta_data,email_confirmed_at) values
('11111111-1111-4111-8111-111111111111','alice@test.invalid','{}',now()),
('22222222-2222-4222-8222-222222222222','bob@test.invalid','{}',now());
insert into public.farms(id,user_id,name) values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-111111111111','Alice farm');
set local role authenticated;
select set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',true);
do $$ begin
 if exists(select 1 from public.farms where id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') then raise exception 'Cross-user farm read'; end if;
 begin
 insert into public.fields(farm_id,name,boundary,area_hectares) values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Intruder',extensions.st_geomfromtext('POLYGON((70 51,70.01 51,70.01 51.01,70 51))',4326),1);
 raise exception 'Cross-user field write allowed';
 exception when insufficient_privilege then null; end;
 begin
 insert into public.crops(name,scientific_name,crop_family,growing_season_days,water_requirement_min_mm,water_requirement_max_mm,drought_tolerance) values('bad','bad','bad',1,1,2,'low');
 raise exception 'Reference crop write allowed';
 exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
do $$ begin
 if not exists(select 1 from public.farms where id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') then raise exception 'Owner cannot read'; end if;
end $$;
rollback;
