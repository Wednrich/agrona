-- Run on a disposable database after migration 006. Synthetic fixtures and
-- the copied function live in an isolated schema and roll back together.
begin;
create schema hls_preflight_test;
create table hls_preflight_test.fields (
  id uuid primary key,
  boundary extensions.geometry(Polygon,4326) not null
);

-- Use the installed function body with the isolated fixture table.
do $$
begin
  execute replace(replace(
    pg_get_functiondef('public.hls_field_preflight(uuid)'::regprocedure),
    'FUNCTION public.hls_field_preflight', 'FUNCTION hls_preflight_test.hls_field_preflight'),
    'public.fields', 'hls_preflight_test.fields');
end $$;

insert into hls_preflight_test.fields values
  ('00000000-0000-4000-8000-000000000001',
    extensions.st_makeenvelope(69.35, 51.19, 69.37, 51.20, 4326)),
  ('00000000-0000-4000-8000-000000000002',
    extensions.st_makeenvelope(67, 49, 71, 52, 4326)),
  ('00000000-0000-4000-8000-000000000003',
    extensions.st_geomfromtext('POLYGON((69 51,69.001 51,69.32 51.2,69.319 51.2,69 51))',4326)),
  ('00000000-0000-4000-8000-000000000004',
    extensions.st_makeenvelope(71.995, 51.19, 72.005, 51.20, 4326));

do $$
declare r record;
begin
  select * into strict r from hls_preflight_test.hls_field_preflight('00000000-0000-4000-8000-000000000001');
  if r.reason is not null or r.estimated_pixels is null or r.estimated_pixels > 250000
    or length(r.revision) <> 64 then raise exception 'Small field should pass: %', r; end if;
  select * into strict r from hls_preflight_test.hls_field_preflight('00000000-0000-4000-8000-000000000002');
  if r.reason is distinct from 'area' then raise exception 'Large area should be rejected: %', r; end if;
  select * into strict r from hls_preflight_test.hls_field_preflight('00000000-0000-4000-8000-000000000003');
  if r.reason is distinct from 'window' or r.estimated_pixels <= 250000
    then raise exception 'Thin diagonal field should exceed the window budget: %', r; end if;
  select * into strict r from hls_preflight_test.hls_field_preflight('00000000-0000-4000-8000-000000000004');
  if r.reason is not null or r.estimated_pixels is null
    then raise exception 'A small field crossing a UTM zone should pass: %', r; end if;
end $$;
rollback;
