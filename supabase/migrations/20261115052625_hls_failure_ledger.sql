-- Additive API: existing workers may finish using the original checkpoint RPC.
-- Failed granules are separate from successfully inspected, empty granules.
create function public.checkpoint_hls_job_v2(
  p_job uuid, p_observations jsonb, p_empty jsonb,
  p_state text, p_warning text, p_progress boolean, p_failures jsonb
) returns boolean language plpgsql security invoker set search_path = '' as $$
declare j public.earth_observation_jobs;
begin
  if jsonb_typeof(p_failures) is distinct from 'array' then
    raise exception 'HLS failures must be an array';
  end if;
  if p_state='succeeded' and jsonb_array_length(p_failures)>0 then
    raise exception 'HLS cannot succeed with unprocessed granules';
  end if;
  select * into j from public.earth_observation_jobs where id=p_job for update;
  if not found then return false; end if;
  if not public.checkpoint_hls_job(p_job,p_observations,p_empty,p_state,p_warning,p_progress)
    then return false; end if;
  update public.field_analytics a
    set vegetation_metrics=jsonb_set(a.vegetation_metrics,'{failed_granules}',p_failures)
    where (a.field_id,a.provider,a.dataset,a.geometry_reference,a.analysis_period)=
      (j.field_id,j.provider,j.dataset,j.geometry_reference,j.requested_period);
  return true;
end $$;
revoke all on function public.checkpoint_hls_job_v2(uuid,jsonb,jsonb,text,text,boolean,jsonb)
  from public,anon,authenticated;
grant execute on function public.checkpoint_hls_job_v2(uuid,jsonb,jsonb,text,text,boolean,jsonb)
  to service_role;
