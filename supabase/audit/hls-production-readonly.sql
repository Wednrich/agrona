-- Metadata and aggregate counts only. Run with `db query --read-only`.
-- Never invoke enqueue_hls/take_hls_job/save_hls_job during the audit.
select jsonb_build_object(
  'versions', jsonb_build_object('postgres', current_setting('server_version'),
    'postgis', (select extversion from pg_extension where extname='postgis')),
  'columns', (select jsonb_agg(to_jsonb(c)) from (
    select table_name,column_name,udt_schema,udt_name,is_nullable,column_default
    from information_schema.columns where table_schema='public'
    and table_name in ('fields','earth_observation_jobs','field_analytics')
    order by table_name,ordinal_position) c),
  'constraints', (select jsonb_agg(to_jsonb(c)) from (
    select conrelid::regclass::text as relation,conname,pg_get_constraintdef(oid) as definition
    from pg_constraint where conrelid in ('public.fields'::regclass,
      'public.earth_observation_jobs'::regclass,'public.field_analytics'::regclass)
    order by conrelid::regclass::text,conname) c),
  'indexes', (select jsonb_agg(to_jsonb(i)) from (
    select tablename,indexname,indexdef from pg_indexes where schemaname='public'
    and tablename in ('fields','earth_observation_jobs','field_analytics') order by indexname) i),
  'policies', (select jsonb_agg(to_jsonb(p)) from (
    select tablename,policyname,roles,cmd,qual,with_check from pg_policies
    where schemaname='public' and tablename in
      ('farms','fields','earth_observation_jobs','field_analytics') order by tablename,policyname) p),
  'relations', (select jsonb_agg(to_jsonb(r)) from (
    select relname,relrowsecurity,relforcerowsecurity,reloptions
    from pg_class join pg_namespace n on n.oid=relnamespace
    where n.nspname='public' and relname in
      ('farms','fields','field_geojson','earth_observation_jobs','field_analytics') order by relname) r),
  'grants', (select jsonb_agg(to_jsonb(g)) from (
    select table_name,grantee,privilege_type from information_schema.role_table_grants
    where table_schema='public' and table_name in
      ('farms','fields','field_geojson','earth_observation_jobs','field_analytics')
    and grantee in ('anon','authenticated','service_role') order by table_name,grantee,privilege_type) g),
  'functions', (select jsonb_agg(to_jsonb(f)) from (
    select p.proname,pg_get_function_identity_arguments(p.oid) as arguments,
      pg_get_function_result(p.oid) as result,p.prosecdef,p.provolatile,p.proconfig,
      pg_get_functiondef(p.oid) as definition,
      has_function_privilege('anon',p.oid,'EXECUTE') as anon_execute,
      has_function_privilege('authenticated',p.oid,'EXECUTE') as authenticated_execute,
      has_function_privilege('service_role',p.oid,'EXECUTE') as service_execute
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in
      ('hls_field_preflight','hls_field','enqueue_hls','take_hls_job','save_hls_job','validate_field')
    order by p.proname) f),
  'triggers', (select jsonb_agg(pg_get_triggerdef(oid)) from pg_trigger
    where tgrelid='public.fields'::regclass and not tgisinternal),
  'queue', (select jsonb_agg(to_jsonb(q)) from (
    select j.dataset,j.status,count(*) as total,
      count(*) filter(where started_at='-infinity') as queued,
      count(*) filter(where started_at<now()-interval '15 minutes' and started_at<>'-infinity' and status='running') as stale_running,
      count(*) filter(where j.geometry_reference=encode(sha256(extensions.st_asewkb(f.boundary)), 'hex')) as current_geometry,
      count(*) filter(where extensions.st_area(f.boundary::extensions.geography)>225000000) as above_area_limit
    from public.earth_observation_jobs j join public.fields f on f.id=j.field_id
    where j.provider='NASA HLS' group by j.dataset,j.status) q),
  'cache', (select jsonb_agg(to_jsonb(c)) from (
    select a.dataset,count(*) as entries,
      sum(jsonb_array_length(coalesce(a.vegetation_metrics->'observations','[]'::jsonb))) as observations,
      count(*) filter(where a.geometry_reference=encode(sha256(extensions.st_asewkb(f.boundary)), 'hex')) as current_geometry
    from public.field_analytics a join public.fields f on f.id=a.field_id
    where a.provider='NASA HLS' group by a.dataset) c)
) as audit;
