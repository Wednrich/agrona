create table public.earth_observation_jobs (
  id uuid primary key default gen_random_uuid(),
  field_id uuid not null references public.fields on delete cascade,
  provider text not null,
  dataset text not null,
  geometry_reference text not null,
  requested_period integer not null,
  status text not null check (status in ('running','succeeded','failed')),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  error_message text,
  unique(field_id,provider,dataset,geometry_reference,requested_period)
);
create table public.earth_observations (
  id uuid primary key default gen_random_uuid(),
  field_id uuid not null references public.fields on delete cascade,
  provider text not null,
  dataset text not null,
  parameter text not null,
  observation_date date not null,
  value double precision,
  unit text not null,
  spatial_resolution text not null,
  geometry_reference text not null,
  retrieved_at timestamptz not null default now(),
  quality_metadata jsonb not null default '{}',
  unique(field_id,provider,dataset,geometry_reference,observation_date,parameter)
);
create table public.field_analytics (
  id uuid primary key default gen_random_uuid(),
  field_id uuid not null references public.fields on delete cascade,
  provider text not null,
  dataset text not null,
  geometry_reference text not null,
  analysis_period integer not null,
  climate_metrics jsonb not null default '{}',
  water_metrics jsonb not null default '{}',
  vegetation_metrics jsonb not null default '{}',
  terrain_metrics jsonb not null default '{}',
  risk_metrics jsonb not null default '{}',
  source_metadata jsonb not null,
  calculated_at timestamptz not null default now(),
  unique(field_id,provider,dataset,geometry_reference,analysis_period)
);
do $$
declare relation text;
begin
  foreach relation in array array['earth_observation_jobs','earth_observations','field_analytics'] loop
    execute format('alter table public.%I enable row level security', relation);
    execute format('revoke all on public.%I from anon, authenticated', relation);
    execute format('grant select on public.%I to authenticated', relation);
    execute format('grant select, insert, update, delete on public.%I to service_role', relation);
    execute format('create policy own_field_read on public.%I for select to authenticated using (
      exists (select 1 from public.fields f join public.farms a on a.id=f.farm_id
              where f.id=field_id and a.user_id=(select auth.uid())))', relation);
  end loop;
end $$;

-- One worker per field/year/revision, with a cooldown and recovery for abandoned jobs.
create function public.claim_earth_job(p_field uuid, p_provider text, p_dataset text, p_geometry text, p_year integer)
returns uuid language sql set search_path = '' as $$
  insert into public.earth_observation_jobs as job
    (field_id,provider,dataset,geometry_reference,requested_period,status)
  values (p_field,p_provider,p_dataset,p_geometry,p_year,'running')
  on conflict (field_id,provider,dataset,geometry_reference,requested_period)
  do update set id=gen_random_uuid(), status='running', started_at=now(), completed_at=null, error_message=null
  where (job.status='running' and job.started_at < now() - interval '3 minutes')
     or (job.status<>'running' and job.completed_at < now() - interval '1 minute')
  returning id;
$$;
revoke all on function public.claim_earth_job(uuid,text,text,text,integer) from public, anon, authenticated;
grant execute on function public.claim_earth_job(uuid,text,text,text,integer) to service_role;

create function public.complete_power_job(p_job uuid, p_observations jsonb, p_metrics jsonb, p_metadata jsonb)
returns void language plpgsql set search_path = '' as $$
declare job public.earth_observation_jobs;
begin
  select * into strict job from public.earth_observation_jobs where id=p_job and status='running' for update;
  delete from public.earth_observations
    where field_id=job.field_id and provider=job.provider and dataset=job.dataset
      and geometry_reference=job.geometry_reference
      and observation_date >= make_date(job.requested_period,1,1)
      and observation_date < make_date(job.requested_period+1,1,1);
  insert into public.earth_observations
    (field_id,provider,dataset,parameter,observation_date,value,unit,spatial_resolution,geometry_reference,quality_metadata)
  select job.field_id,job.provider,job.dataset,o.parameter,o.observation_date,o.value,o.unit,o.spatial_resolution,
    job.geometry_reference,jsonb_build_object('missing',o.value is null)
  from jsonb_to_recordset(p_observations) as o(parameter text, observation_date date,value double precision,unit text,spatial_resolution text);
  insert into public.field_analytics
    (field_id,provider,dataset,geometry_reference,analysis_period,climate_metrics,water_metrics,risk_metrics,source_metadata)
  values (job.field_id,job.provider,job.dataset,job.geometry_reference,job.requested_period,p_metrics,
    jsonb_build_object('rain',p_metrics->'rain','longestDry',p_metrics->'longestDry'),
    jsonb_build_object('hotDays',p_metrics->'hotDays','frostDays',p_metrics->'frostDays','heavyRainDays',p_metrics->'heavyRainDays'),p_metadata)
  on conflict (field_id,provider,dataset,geometry_reference,analysis_period)
  do update set climate_metrics=excluded.climate_metrics,water_metrics=excluded.water_metrics,
    risk_metrics=excluded.risk_metrics,source_metadata=excluded.source_metadata,calculated_at=now();
  update public.earth_observation_jobs set status='succeeded',completed_at=now() where id=p_job;
end;
$$;
revoke all on function public.complete_power_job(uuid,jsonb,jsonb,jsonb) from public, anon, authenticated;
grant execute on function public.complete_power_job(uuid,jsonb,jsonb,jsonb) to service_role;
