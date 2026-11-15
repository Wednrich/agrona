-- Disposable LOCAL database only, after 001–006. All fixtures roll back.
begin;
insert into auth.users(id,email,raw_user_meta_data,email_confirmed_at) values
('11111111-1111-4111-8111-111111111111','owner@test.invalid','{}',now()),
('22222222-2222-4222-8222-222222222222','other@test.invalid','{}',now());
insert into public.farms(id,user_id,name) values
('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-111111111111','Fixture');
insert into public.fields(id,farm_id,name,boundary,area_hectares) values
('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
 'Fixture',extensions.st_makeenvelope(69.35,51.19,69.37,51.20,4326),1);
set local role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
do $$
declare r record; previous text;
begin
 select * into strict r from public.hls_field_preflight('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
 select revision into strict previous from public.hls_field('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
 if r.revision is distinct from previous or r.reason is not null then
   raise exception 'Preflight must preserve existing HLS cache revision'; end if;
 if has_function_privilege('authenticated','public.enqueue_hls(uuid,text,integer)','EXECUTE')
   or has_function_privilege('authenticated','public.take_hls_job()','EXECUTE')
   or has_function_privilege('authenticated','public.save_hls_job(uuid,jsonb,boolean,text)','EXECUTE') then
   raise exception 'Privileged HLS RPC exposed'; end if;
 if exists(select 1 from public.hls_field_preflight('cccccccc-cccc-4ccc-8ccc-cccccccccccc')) then
   raise exception 'Missing field must return no rows'; end if;
end $$;
select set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',true);
do $$ begin
 if exists(select 1 from public.hls_field_preflight('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')) then
   raise exception 'Preflight leaked another owner field'; end if;
end $$;
set local role anon;
do $$ begin
 begin
   perform * from public.hls_field_preflight('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
   raise exception 'Anonymous preflight was allowed';
 exception when insufficient_privilege then null;
 end;
end $$;
rollback;
