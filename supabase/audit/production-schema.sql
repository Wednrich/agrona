-- Catalog definitions only. No application rows, credentials, or auth records.
with relations as (
  select c.*, n.nspname from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relname in (
    'profiles','farms','fields','crops','field_seasons','climate_observations',
    'analysis_results','rotation_scenarios','field_geojson',
    'earth_observation_jobs','earth_observations','field_analytics'
  )
), definitions as (
  select 'relation' as kind, relname as object, jsonb_build_object(
    'kind', relkind, 'rls', relrowsecurity, 'force_rls', relforcerowsecurity,
    'options', reloptions, 'acl', relacl, 'owner',pg_get_userbyid(relowner),
    'view', case when relkind='v' then pg_get_viewdef(oid) end) as definition from relations
  union all
  select 'column',r.relname||'.'||a.attname,jsonb_build_object(
    'type',format_type(a.atttypid,a.atttypmod),'required',a.attnotnull,
    'default',pg_get_expr(d.adbin,d.adrelid),'identity',a.attidentity,'generated',a.attgenerated)
    from relations r join pg_attribute a on a.attrelid=r.oid and a.attnum>0 and not a.attisdropped
    left join pg_attrdef d on d.adrelid=r.oid and d.adnum=a.attnum
  union all
  select 'constraint',r.relname||'.'||c.conname,jsonb_build_object('sql',pg_get_constraintdef(c.oid),'validated',c.convalidated)
    from relations r join pg_constraint c on c.conrelid=r.oid
  union all
  select 'index',r.relname||'.'||i.relname,jsonb_build_object('sql',pg_get_indexdef(i.oid),'valid',x.indisvalid)
    from relations r join pg_index x on x.indrelid=r.oid join pg_class i on i.oid=x.indexrelid
  union all
  select 'trigger',t.tgrelid::regclass::text||'.'||t.tgname,jsonb_build_object('sql',pg_get_triggerdef(t.oid),'enabled',t.tgenabled)
    from pg_trigger t where not t.tgisinternal and (t.tgrelid in (select oid from relations) or t.tgrelid='auth.users'::regclass)
  union all
  select 'policy',p.tablename||'.'||p.policyname,to_jsonb(p)
    from pg_policies p join relations r on r.relname=p.tablename and r.nspname=p.schemaname
  union all
  select 'function',n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')',
    jsonb_build_object('sql',pg_get_functiondef(p.oid),'acl',p.proacl,'owner',pg_get_userbyid(p.proowner))
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where p.prokind='f' and ((n.nspname='public' and p.proname in (
      'validate_field','touch_updated_at','handle_signup','claim_earth_job','complete_power_job',
      'sentinel_field_geometry','complete_sentinel_job'))
      or p.oid in (select tgfoid from pg_trigger where not tgisinternal and
        (tgrelid='auth.users'::regclass or tgrelid in (select oid from relations))))
  union all
  select 'extension',e.extname,jsonb_build_object('schema',n.nspname,'version',e.extversion)
    from pg_extension e join pg_namespace n on n.oid=e.extnamespace where e.extname='postgis'
)
select kind,object,definition from definitions order by kind,object;
