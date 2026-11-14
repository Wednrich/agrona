create extension if not exists postgis with schema extensions;
create table public.profiles (id uuid primary key references auth.users on delete cascade, full_name text not null default '', country text not null default '', region text not null default '', created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table public.farms (id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles on delete cascade, name text not null check(length(trim(name)) between 1 and 120), country text not null default '', region text not null default '', created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create index farms_owner on public.farms(user_id);
create table public.fields (id uuid primary key default gen_random_uuid(), farm_id uuid not null references public.farms on delete cascade, name text not null check(length(trim(name)) between 1 and 120), boundary extensions.geometry(Polygon,4326) not null, area_hectares numeric not null check(area_hectares > 0), soil_type text not null default '', irrigation_type text not null default '', created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create index fields_farm on public.fields(farm_id);
create index fields_geometry on public.fields using gist(boundary);
create table public.crops (id uuid primary key default gen_random_uuid(), name text not null unique, scientific_name text not null, crop_family text not null, growing_season_days integer not null check(growing_season_days > 0), water_requirement_min_mm numeric not null check(water_requirement_min_mm >= 0), water_requirement_max_mm numeric not null, nitrogen_fixation boolean not null default false, drought_tolerance text not null check(drought_tolerance in ('low','medium','high')), check(water_requirement_max_mm >= water_requirement_min_mm));
create table public.field_seasons (id uuid primary key default gen_random_uuid(), field_id uuid not null references public.fields on delete cascade, year integer not null check(year between 1900 and 2200), crop_id uuid not null references public.crops, planting_date date, harvest_date date, yield_tons_per_hectare numeric check(yield_tons_per_hectare >= 0), irrigation_amount_mm numeric check(irrigation_amount_mm >= 0), notes text not null default '', unique(field_id,year), check(harvest_date is null or planting_date is null or harvest_date >= planting_date));
create table public.climate_observations (id uuid primary key default gen_random_uuid(), field_id uuid not null references public.fields on delete cascade, observation_date date not null, source text not null, temperature_mean numeric, temperature_max numeric, temperature_min numeric, precipitation_mm numeric check(precipitation_mm >= 0), solar_radiation numeric check(solar_radiation >= 0), retrieved_at timestamptz not null default now(), unique(field_id,observation_date,source));
create table public.analysis_results (id uuid primary key default gen_random_uuid(), field_id uuid not null references public.fields on delete cascade, analysis_type text not null, result jsonb not null, source_metadata jsonb not null, created_at timestamptz not null default now());
create table public.rotation_scenarios (id uuid primary key default gen_random_uuid(), field_id uuid not null references public.fields on delete cascade, name text not null, priorities jsonb not null, constraints jsonb not null, crop_sequence jsonb not null, analysis_result jsonb not null, created_at timestamptz not null default now());
create index seasons_field on public.field_seasons(field_id);
create index analysis_field on public.analysis_results(field_id);
create index scenarios_field on public.rotation_scenarios(field_id);
create function public.validate_field() returns trigger language plpgsql set search_path = public,extensions as $$
begin
 if not st_isvalid(new.boundary) or st_isempty(new.boundary) or st_npoints(new.boundary) > 10000 or st_xmin(new.boundary::box3d) < -180 or st_xmax(new.boundary::box3d) > 180 or st_ymin(new.boundary::box3d) < -90 or st_ymax(new.boundary::box3d) > 90 then raise exception 'Invalid field polygon'; end if;
 new.area_hectares := st_area(new.boundary::geography)/10000;
 new.updated_at := now();
 return new;
end $$;
create trigger validate_field before insert or update on public.fields for each row execute function public.validate_field();
create function public.touch_updated_at() returns trigger language plpgsql set search_path = '' as $$ begin new.updated_at := now(); return new; end $$;
create trigger profile_updated before update on public.profiles for each row execute function public.touch_updated_at();
create trigger farm_updated before update on public.farms for each row execute function public.touch_updated_at();
create function public.handle_signup() returns trigger language plpgsql security definer set search_path = '' as $$
begin
 insert into public.profiles(id,full_name,country,region) values(new.id,coalesce(new.raw_user_meta_data->>'full_name',''),coalesce(new.raw_user_meta_data->>'country',''),coalesce(new.raw_user_meta_data->>'region',''));
 if length(trim(coalesce(new.raw_user_meta_data->>'farm_name',''))) > 0 then
 insert into public.farms(user_id,name,country,region) values(new.id,left(new.raw_user_meta_data->>'farm_name',120),coalesce(new.raw_user_meta_data->>'country',''),coalesce(new.raw_user_meta_data->>'region','')); end if;
 return new;
end $$;
create trigger auth_user_created after insert on auth.users for each row execute function public.handle_signup();
alter table public.profiles enable row level security;
create policy own_profile on public.profiles for all to authenticated using(id = (select auth.uid())) with check(id = (select auth.uid()));
alter table public.farms enable row level security;
create policy own_farms on public.farms for all to authenticated using(user_id = (select auth.uid())) with check(user_id = (select auth.uid()));
alter table public.fields enable row level security;
create policy own_fields on public.fields for all to authenticated using(exists(select 1 from public.farms where id = farm_id and user_id = (select auth.uid()))) with check(exists(select 1 from public.farms where id = farm_id and user_id = (select auth.uid())));
alter table public.crops enable row level security;
create policy read_crops on public.crops for select using(true);
do $$ declare t text; begin foreach t in array array['field_seasons','climate_observations','analysis_results','rotation_scenarios'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('create policy own_records on public.%I for all to authenticated using(exists(select 1 from public.fields f join public.farms a on a.id=f.farm_id where f.id=field_id and a.user_id=(select auth.uid()))) with check(exists(select 1 from public.fields f join public.farms a on a.id=f.farm_id where f.id=field_id and a.user_id=(select auth.uid())))',t);
end loop; end $$;
-- GeoJSON view uses caller permissions, including RLS.
create view public.field_geojson with (security_invoker=true) as select id,farm_id,name,extensions.st_asgeojson(boundary)::jsonb as boundary,area_hectares,soil_type,irrigation_type,created_at,updated_at from public.fields;
grant select on public.field_geojson to authenticated;
grant select on public.crops to anon,authenticated;
grant select,insert,update,delete on public.profiles,public.farms,public.fields,public.field_seasons,public.climate_observations,public.analysis_results,public.rotation_scenarios to authenticated;
revoke all on public.crops from authenticated;
grant select on public.crops to authenticated;
-- Indicative agronomic reference ranges, not locally calibrated recommendations.
insert into public.crops(id,name,scientific_name,crop_family,growing_season_days,water_requirement_min_mm,water_requirement_max_mm,nitrogen_fixation,drought_tolerance) values
('00000000-0000-4000-8000-000000000001','Пшеница','Triticum aestivum','Poaceae',120,450,650,false,'medium'),
('00000000-0000-4000-8000-000000000002','Ячмень','Hordeum vulgare','Poaceae',100,450,650,false,'high'),
('00000000-0000-4000-8000-000000000003','Горох','Pisum sativum','Fabaceae',100,350,500,true,'low'),
('00000000-0000-4000-8000-000000000004','Подсолнечник','Helianthus annuus','Asteraceae',130,600,1000,false,'high'),
('00000000-0000-4000-8000-000000000005','Соя','Glycine max','Fabaceae',130,450,700,true,'medium');
