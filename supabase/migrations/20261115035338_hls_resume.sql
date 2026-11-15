-- Keep existing scopes and observations. A queued partial job uses the same
-- running/-infinity representation, with completed_at as its next claim time.
alter table public.earth_observation_jobs
  add column hls_no_progress integer not null default 0;

create or replace function public.enqueue_hls(p_field uuid, p_revision text, p_year integer)
returns void language sql set search_path = '' as $$
  insert into public.earth_observation_jobs as j
    (field_id,provider,dataset,geometry_reference,requested_period,status,started_at)
  values (p_field,'NASA HLS','hls-v2-ndvi-v1',p_revision,p_year,'running','-infinity')
  on conflict (field_id,provider,dataset,geometry_reference,requested_period)
  do update set id=gen_random_uuid(),status='running',started_at='-infinity',completed_at=null,error_message=null,hls_no_progress=0
  where (j.status='failed' and j.completed_at < now() - interval '30 minutes')
     or (j.status='succeeded' and j.completed_at < now() - interval '180 days');
$$;

create function public.take_hls_job_for(p_field uuid, p_year integer)
returns table(job_id uuid, field_id uuid, analysis_year integer, boundary jsonb, cached jsonb)
language sql set search_path = public, extensions as $$
  with next_job as (
    select j.id from public.earth_observation_jobs j
    join public.fields f on f.id=j.field_id
    where j.provider='NASA HLS' and j.dataset='hls-v2-ndvi-v1' and j.status='running'
      and j.started_at < now()-interval '15 minutes'
      and (p_field is null or j.field_id=p_field)
      and (p_year is null or j.requested_period=p_year)
      and (j.started_at <> '-infinity' or j.completed_at is null or j.completed_at <= now())
      and j.geometry_reference=encode(sha256(st_asewkb(f.boundary)), 'hex')
    order by coalesce(j.completed_at, nullif(j.started_at, '-infinity'), '-infinity'),j.id limit 1 for update of j skip locked
  ), leased as (
    update public.earth_observation_jobs j set started_at=now(),completed_at=null,error_message=null,id=gen_random_uuid()
    from next_job n where j.id=n.id returning j.*
  )
  select j.id,j.field_id,j.requested_period,st_asgeojson(f.boundary)::jsonb,
    coalesce(a.vegetation_metrics->'observations','[]'::jsonb) ||
    coalesce(a.vegetation_metrics->'empty_granules','[]'::jsonb)
  from leased j join public.fields f on f.id=j.field_id
  left join public.field_analytics a on
    (a.field_id,a.provider,a.dataset,a.geometry_reference,a.analysis_period)=
    (j.field_id,j.provider,j.dataset,j.geometry_reference,j.requested_period);
$$;

revoke all on function public.take_hls_job_for(uuid,integer) from public, anon, authenticated;
grant execute on function public.take_hls_job_for(uuid,integer) to service_role;

create or replace function public.take_hls_job()
returns table(job_id uuid, field_id uuid, analysis_year integer, boundary jsonb, cached jsonb)
language sql set search_path = '' as $$
  select * from public.take_hls_job_for(null,null);
$$;

create function public.checkpoint_hls_job(
  p_job uuid, p_observations jsonb, p_empty jsonb,
  p_state text, p_warning text, p_progress boolean
)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare j public.earth_observation_jobs;
begin
  if p_state is null or p_state not in ('checkpoint','partial','succeeded','failed') then
    raise exception 'Invalid HLS checkpoint state';
  end if;
  -- The lease UUID changes on claim. A retry after a successful release
  -- must also be rejected even if nobody has claimed the job again yet.
  select * into j from public.earth_observation_jobs
    where id=p_job and status='running' and started_at <> '-infinity'
      and provider='NASA HLS' and dataset='hls-v2-ndvi-v1' for update;
  if not found then return false; end if;
  if not public.save_hls_job(p_job,p_observations,p_state='succeeded',
    case when p_state='failed' then coalesce(p_warning,'Ошибка NASA HLS.') end)
  then return false; end if;

  update public.field_analytics a
    set vegetation_metrics=jsonb_set(a.vegetation_metrics,'{empty_granules}',p_empty)
    where (a.field_id,a.provider,a.dataset,a.geometry_reference,a.analysis_period)=
      (j.field_id,j.provider,j.dataset,j.geometry_reference,j.requested_period);

  if p_state='partial' then
    update public.earth_observation_jobs set
      hls_no_progress=case when p_progress then 0 else j.hls_no_progress+1 end,
      status=case when not p_progress and j.hls_no_progress>=4 then 'failed' else 'running' end,
      started_at=case when not p_progress and j.hls_no_progress>=4 then now() else '-infinity' end,
      completed_at=case
        when not p_progress and j.hls_no_progress>=4 then now()
        when p_warning is not null then now()+interval '2 minutes'
        else now()
      end,
      error_message=coalesce(p_warning,'Анализ NASA HLS приостановлен по лимиту времени.')
      where id=p_job;
  end if;
  return true;
end;
$$;
revoke all on function public.checkpoint_hls_job(uuid,jsonb,jsonb,text,text,boolean)
  from public, anon, authenticated;
grant execute on function public.checkpoint_hls_job(uuid,jsonb,jsonb,text,text,boolean)
  to service_role;
