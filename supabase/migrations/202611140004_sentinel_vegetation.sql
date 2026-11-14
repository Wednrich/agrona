-- Field ownership is enforced through the existing fields RLS policy.
create function public.sentinel_field_geometry(p_field uuid)
returns table (boundary jsonb, projected jsonb, mercator jsonb, mercator_bounds jsonb, epsg integer, geometry_reference text, width_m double precision, height_m double precision)
language sql stable security invoker set search_path = public, extensions as $$
  with target as (
    select f.boundary as shape, st_pointonsurface(f.boundary) as point
    from public.fields f where f.id = p_field
  ), projection as (
    select shape,
      (case when st_y(point) >= 0 then 32600 else 32700 end)
        + least(60, greatest(1, floor((st_x(point)+180)/6)::integer+1)) as srid
    from target where st_y(point) between -80 and 84
  ), transformed as (
    select shape, srid, st_transform(shape, srid) as grid, st_transform(shape, 3857) as layer from projection
  )
  select st_asgeojson(shape)::jsonb, st_asgeojson(grid)::jsonb - 'crs', st_asgeojson(layer)::jsonb - 'crs',
    jsonb_build_array(st_xmin(layer),st_ymin(layer),st_xmax(layer),st_ymax(layer)), srid,
    encode(sha256(st_asewkb(shape)), 'hex'),
    st_xmax(grid)-st_xmin(grid), st_ymax(grid)-st_ymin(grid)
  from transformed;
$$;
revoke all on function public.sentinel_field_geometry(uuid) from public, anon;
grant execute on function public.sentinel_field_geometry(uuid) to authenticated;

create function public.complete_sentinel_job(p_job uuid, p_metrics jsonb, p_metadata jsonb)
returns void language plpgsql set search_path = '' as $$
declare job public.earth_observation_jobs;
begin
  select * into strict job from public.earth_observation_jobs
    where id=p_job and status='running' and dataset='sentinel-2-l2a-ndvi-v1'
    for update;
  insert into public.field_analytics
    (field_id,provider,dataset,geometry_reference,analysis_period,vegetation_metrics,source_metadata)
  values
    (job.field_id,job.provider,job.dataset,job.geometry_reference,job.requested_period,p_metrics,p_metadata)
  on conflict (field_id,provider,dataset,geometry_reference,analysis_period)
  do update set vegetation_metrics=excluded.vegetation_metrics,
    source_metadata=excluded.source_metadata,calculated_at=now();
  update public.earth_observation_jobs set status='succeeded',completed_at=now() where id=p_job;
end;
$$;
revoke all on function public.complete_sentinel_job(uuid,jsonb,jsonb) from public, anon, authenticated;
grant execute on function public.complete_sentinel_job(uuid,jsonb,jsonb) to service_role;
