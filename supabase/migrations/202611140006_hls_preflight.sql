-- Estimate the whole field before queueing. Actual GeoTIFF windows are still
-- checked by the worker, using each scene's CRS, grid origin and tile extent.
create function public.hls_field_preflight(p_field uuid)
returns table(revision text, reason text, estimated_pixels bigint)
language sql stable security invoker set search_path = public, extensions as $$
  with target as (
    select f.boundary as shape,
      st_area(f.boundary::geography) as area_m2,
      st_xmin(f.boundary) as west, st_xmax(f.boundary) as east,
      st_ymin(f.boundary) as south, st_ymax(f.boundary) as north
    from public.fields f where f.id = p_field
  ), classified as (
    select *, case
      when area_m2 > 250000 * 30.0 * 30.0 then 'area'
      when south < -80 or north > 84 or east - west >= 180 then 'projection'
      -- Oversized longitude spans cannot be estimated reliably in nearby UTM zones.
      when east - west > 6 then 'extent'
    end as blocked
    from target
  )
  select encode(sha256(st_asewkb(shape)), 'hex'),
    coalesce(blocked, case when estimate.pixels > 250000 then 'window' end),
    estimate.pixels::bigint
  from classified
  left join lateral (
    select max((ceil((st_xmax(grid) - st_xmin(grid)) / 30.0) + 2)
             * (ceil((st_ymax(grid) - st_ymin(grid)) / 30.0) + 2)) as pixels
    from (
      select st_transform(st_segmentize(shape, 0.01),
          (case when south < 0 and north <= 0 then 32700 else 32600 end)
          + 1 + ((zone + 59) % 60)) as grid
      from generate_series(floor((west + 180) / 6)::integer,
                           floor((east + 180) / 6)::integer + 2) as zones(zone)
      where blocked is null
    ) projected
  ) estimate on true;
$$;
revoke all on function public.hls_field_preflight(uuid) from public, anon;
grant execute on function public.hls_field_preflight(uuid) to authenticated;
