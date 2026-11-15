-- Disposable local database. Exercise the installed RPCs with synthetic data.
begin;
insert into auth.users(id,email,raw_user_meta_data,email_confirmed_at) values
('11111111-1111-4111-8111-111111111111','owner@test.invalid','{}',now());
insert into public.farms(id,user_id,name) values
('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-111111111111','Fixture');
insert into public.fields(id,farm_id,name,boundary,area_hectares) values
('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
 'Fixture',extensions.st_makeenvelope(69.35,51.19,69.37,51.20,4326),1);
set local role service_role;
do $$
declare
  field uuid := 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  revision text;
  first_lease uuid;
  second_lease uuid;
  third_lease uuid;
  cached_rows jsonb;
  observations jsonb := '[{"conceptId":"scene","revisionId":1,"acquiredAt":"2025-06-01"}]';
  empty_rows jsonb := '[{"conceptId":"empty","revisionId":2,"empty":true}]';
begin
  select h.revision into strict revision from public.hls_field(field) h;
  if has_function_privilege('anon','public.checkpoint_hls_job_v2(uuid,jsonb,jsonb,text,text,boolean,jsonb)','execute')
     or has_function_privilege('authenticated','public.checkpoint_hls_job_v2(uuid,jsonb,jsonb,text,text,boolean,jsonb)','execute')
    then raise exception 'Failure ledger exposed to clients'; end if;
  perform public.enqueue_hls(field,revision,2025);
  select job_id into strict first_lease from public.take_hls_job_for(field,2025);
  if not public.checkpoint_hls_job_v2(first_lease,observations,empty_rows,'checkpoint',null,true,
    '[{"conceptId":"unavailable","revisionId":1,"reason":"asset_unavailable"}]')
    then raise exception 'Failure checkpoint rejected'; end if;
  if not exists(select 1 from public.field_analytics where field_id=field
    and jsonb_array_length(vegetation_metrics->'failed_granules')=1
    and vegetation_metrics->'empty_granules'=empty_rows)
    then raise exception 'Errors and empty granules were mixed'; end if;
  begin
    perform public.checkpoint_hls_job_v2(first_lease,observations,empty_rows,'succeeded',null,true,'[{"conceptId":"unavailable"}]');
    raise exception 'Succeeded accepted failures';
  exception when raise_exception then
    if sqlerrm <> 'HLS cannot succeed with unprocessed granules' then raise; end if;
  end;

  if not public.checkpoint_hls_job_v2(first_lease,observations,empty_rows,'partial','Provider unavailable',true,'[]')
    then raise exception 'Partial save rejected'; end if;
  if exists(select 1 from public.take_hls_job_for(field,2025))
    then raise exception 'Retry delay ignored'; end if;
  if public.checkpoint_hls_job_v2(first_lease,'[]','[]','succeeded',null,false,'[]')
    then raise exception 'Released lease was allowed to overwrite cache'; end if;

  update public.earth_observation_jobs set completed_at=now() where id=first_lease;
  select job_id,cached into strict second_lease,cached_rows from public.take_hls_job_for(field,2025);
  if second_lease=first_lease or cached_rows<>observations||empty_rows
    then raise exception 'Resume lost the checkpoint or reused the lease'; end if;
  update public.earth_observation_jobs set started_at=now()-interval '16 minutes' where id=second_lease;
  select job_id into strict third_lease from public.take_hls_job_for(field,2025);
  if third_lease=second_lease or public.checkpoint_hls_job_v2(second_lease,'[]','[]','succeeded',null,false,'[]')
    then raise exception 'Expired worker can overwrite the current lease'; end if;

  update public.fields set boundary=extensions.st_makeenvelope(69.35,51.19,69.38,51.20,4326)
    where id=field;
  if public.checkpoint_hls_job_v2(third_lease,'[]','[]','succeeded',null,false,'[]')
    then raise exception 'Old geometry accepted'; end if;
  if not exists(select 1 from public.field_analytics where field_id=field
    and geometry_reference=revision and vegetation_metrics->'observations'=observations)
    then raise exception 'Historical observations lost'; end if;
  select h.revision into strict revision from public.hls_field(field) h;
  perform public.enqueue_hls(field,revision,2025);
  select job_id,cached into strict first_lease,cached_rows from public.take_hls_job_for(field,2025);
  if cached_rows <> '[]' then raise exception 'New geometry reused old observations'; end if;
  if not public.checkpoint_hls_job_v2(first_lease,observations,'[]','succeeded',null,true,'[]')
    then raise exception 'Final checkpoint was rejected'; end if;
  if not exists(select 1 from public.earth_observation_jobs where id=first_lease and status='succeeded')
    then raise exception 'Final checkpoint did not succeed'; end if;

  -- A provider outage must not leave a job retrying indefinitely.
  perform public.enqueue_hls(field,revision,2024);
  for attempt in 1..5 loop
    select job_id into strict first_lease from public.take_hls_job_for(field,2024);
    if not public.checkpoint_hls_job_v2(first_lease,observations,'[]','partial','Provider unavailable',false,'[]')
      then raise exception 'Retry checkpoint rejected'; end if;
    update public.earth_observation_jobs set completed_at=now() where id=first_lease;
  end loop;
  if not exists(select 1 from public.earth_observation_jobs
    where id=first_lease and status='failed' and hls_no_progress=5)
    or exists(select 1 from public.take_hls_job_for(field,2024))
    then raise exception 'No-progress retry budget was not enforced'; end if;
  if not exists(select 1 from public.field_analytics where field_id=field
    and geometry_reference=revision and analysis_period=2024 and vegetation_metrics->'observations'=observations)
    then raise exception 'Retry exhaustion lost saved observations'; end if;
end $$;
rollback;
