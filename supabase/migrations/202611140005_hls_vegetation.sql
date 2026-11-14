-- A scope-specific queue reuses the existing jobs and analytics tables.
create function public.hls_field(p_field uuid)
returns table(boundary jsonb, revision text)
language sql stable security invoker set search_path = public, extensions as $$
  select st_asgeojson(f.boundary)::jsonb, encode(sha256(st_asewkb(f.boundary)), 'hex')
  from public.fields f where f.id=p_field;
$$;
revoke all on function public.hls_field(uuid) from public, anon;
grant execute on function public.hls_field(uuid) to authenticated, service_role;

create function public.enqueue_hls(p_field uuid, p_revision text, p_year integer)
returns void language sql set search_path = '' as $$
  insert into public.earth_observation_jobs as j
    (field_id,provider,dataset,geometry_reference,requested_period,status,started_at)
  values (p_field,'NASA HLS','hls-v2-ndvi-v1',p_revision,p_year,'running','-infinity')
  on conflict (field_id,provider,dataset,geometry_reference,requested_period)
  do update set id=gen_random_uuid(),status='running',started_at='-infinity',completed_at=null,error_message=null
  where (j.status='failed' and j.completed_at < now() - interval '30 minutes')
     or (j.status='succeeded' and j.completed_at < now() - interval '180 days');
$$;

create function public.take_hls_job()
returns table(job_id uuid, field_id uuid, analysis_year integer, boundary jsonb, cached jsonb)
language sql set search_path = public, extensions as $$
  with next_job as (
    select j.id from public.earth_observation_jobs j
    join public.fields f on f.id=j.field_id
    where j.provider='NASA HLS' and j.dataset='hls-v2-ndvi-v1' and j.status='running'
      and j.started_at < now()-interval '15 minutes'
      and j.geometry_reference=encode(sha256(st_asewkb(f.boundary)), 'hex')
    order by j.started_at,j.id limit 1 for update of j skip locked
  ), leased as (
    update public.earth_observation_jobs j set started_at=now(),id=gen_random_uuid()
    from next_job n where j.id=n.id returning j.*
  )
  select j.id,j.field_id,j.requested_period,st_asgeojson(f.boundary)::jsonb,
    coalesce(a.vegetation_metrics->'observations','[]'::jsonb)
  from leased j join public.fields f on f.id=j.field_id
  left join public.field_analytics a on
    (a.field_id,a.provider,a.dataset,a.geometry_reference,a.analysis_period)=
    (j.field_id,j.provider,j.dataset,j.geometry_reference,j.requested_period);
$$;

create function public.save_hls_job(p_job uuid,p_observations jsonb,p_done boolean,p_error text)
returns boolean language plpgsql set search_path = public, extensions as $$
declare j public.earth_observation_jobs;
begin
  select * into j from public.earth_observation_jobs where id=p_job and status='running'
    and provider='NASA HLS' and dataset='hls-v2-ndvi-v1' for update;
  if not found then return false; end if;
  if not exists(select 1 from public.fields f where f.id=j.field_id
    and encode(sha256(st_asewkb(f.boundary)), 'hex')=j.geometry_reference) then
    update public.earth_observation_jobs set status='failed',completed_at=now(),error_message='Граница изменилась.' where id=p_job;
    return false;
  end if;
  insert into public.field_analytics
    (field_id,provider,dataset,geometry_reference,analysis_period,vegetation_metrics,source_metadata)
  values (j.field_id,j.provider,j.dataset,j.geometry_reference,j.requested_period,
    jsonb_build_object('observations',p_observations),
    jsonb_build_object('source','NASA LP DAAC HLS v2.0','resolution_m',30,'scale',0.0001,
      'excluded_fmask_bits',array[1,2,3,4,5],'high_aerosol_excluded',true,
      'method','Native UTM grid, pixel centers inside polygon; water excluded and counted separately'))
  on conflict (field_id,provider,dataset,geometry_reference,analysis_period)
  do update set vegetation_metrics=excluded.vegetation_metrics,source_metadata=excluded.source_metadata,calculated_at=now();
  update public.earth_observation_jobs set
    status=case when p_error is not null then 'failed' when p_done then 'succeeded' else 'running' end,
    completed_at=case when p_done or p_error is not null then now() end,
    started_at=now(), error_message=p_error where id=p_job;
  return true;
end;
$$;
revoke all on function public.enqueue_hls(uuid,text,integer), public.take_hls_job(),
  public.save_hls_job(uuid,jsonb,boolean,text) from public, anon, authenticated;
grant execute on function public.enqueue_hls(uuid,text,integer), public.take_hls_job(),
  public.save_hls_job(uuid,jsonb,boolean,text) to service_role;
