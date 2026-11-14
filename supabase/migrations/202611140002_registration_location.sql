alter table public.profiles
  add column country_code text check (country_code ~ '^[A-Z]{2}$'),
  add column location_id text,
  add column latitude double precision check (latitude between -90 and 90),
  add column longitude double precision check (longitude between -180 and 180),
  add constraint profiles_location_complete check (
    num_nonnulls(country_code, location_id, latitude, longitude) in (0, 4)
  );

create or replace function public.handle_signup() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  metadata jsonb := new.raw_user_meta_data;
  farm_name text := left(trim(coalesce(metadata->>'farm_name', '')), 120);
  inserted_profile uuid;
  country_code text;
  location_id text;
  latitude double precision;
  longitude double precision;
begin
  if new.email_confirmed_at is null then return new; end if;

  -- Metadata is user-controlled. Accept only a complete, bounded location tuple.
  if metadata->>'country_code' ~ '^[A-Z]{2}$'
     and length(trim(metadata->>'location_id')) between 1 and 200
     and jsonb_typeof(metadata->'latitude') = 'number'
     and jsonb_typeof(metadata->'longitude') = 'number'
     and (metadata->>'latitude')::numeric between -90 and 90
     and (metadata->>'longitude')::numeric between -180 and 180 then
    country_code := metadata->>'country_code';
    location_id := metadata->>'location_id';
    latitude := (metadata->>'latitude')::double precision;
    longitude := (metadata->>'longitude')::double precision;
  end if;

  insert into public.profiles(id, full_name, country, region, country_code, location_id, latitude, longitude)
  values(new.id, left(coalesce(metadata->>'full_name', ''),120),
         left(coalesce(metadata->>'country', ''),120), left(coalesce(metadata->>'region', ''),120),
         country_code, location_id, latitude, longitude)
  on conflict (id) do nothing returning id into inserted_profile;

  if inserted_profile is not null and farm_name <> '' then
    insert into public.farms(user_id, name, country, region)
    values(new.id, farm_name, left(coalesce(metadata->>'country', ''),120),
           left(coalesce(metadata->>'region', ''),120));
  end if;
  return new;
end;
$$;

create trigger auth_user_email_confirmed
after update of email_confirmed_at on auth.users
for each row when (old.email_confirmed_at is null and new.email_confirmed_at is not null)
execute function public.handle_signup();
