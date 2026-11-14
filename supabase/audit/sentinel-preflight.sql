-- Metadata and aggregate checks only. Mirrors the projection in migration 004.
with targets as (
  select f.boundary as shape, extensions.st_pointonsurface(f.boundary) as point
  from public.fields f
), grids as (
  select shape, extensions.st_transform(shape,
    (case when extensions.st_y(point) >= 0 then 32600 else 32700 end)
      + least(60, greatest(1, floor((extensions.st_x(point)+180)/6)::integer+1))) as utm
  from targets where extensions.st_y(point) between -80 and 84
), eligible as (
  select * from grids where extensions.st_xmax(utm)>extensions.st_xmin(utm)
    and extensions.st_ymax(utm)>extensions.st_ymin(utm)
)
select
  (select count(*) from targets) as saved_fields,
  count(*) as valid_projection_extents,
  count(encode(sha256(extensions.st_asewkb(shape)), 'hex')) as boundary_hashes,
  count(extensions.st_asgeojson(extensions.st_transform(shape, 3857))) as preview_geometries,
  (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in ('sentinel_field_geometry','complete_sentinel_job')) as sentinel_function_collisions
from eligible;
