create table public.ai_advisor_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  field_id uuid not null references public.fields(id) on delete cascade,
  fingerprint text not null check (length(fingerprint) = 64),
  started_at timestamptz not null default clock_timestamp(),
  finished_at timestamptz,
  answer jsonb,
  prompt_tokens integer check (prompt_tokens >= 0),
  completion_tokens integer check (completion_tokens >= 0)
);

create index ai_advisor_requests_user_time
  on public.ai_advisor_requests (user_id, started_at desc);
create index ai_advisor_requests_field on public.ai_advisor_requests (field_id);

alter table public.ai_advisor_requests enable row level security;
revoke all on public.ai_advisor_requests from public, anon, authenticated;
grant select, insert, update, delete on public.ai_advisor_requests to service_role;

create function public.claim_ai_advisor_request(p_user uuid, p_field uuid, p_hash text)
returns jsonb language plpgsql set search_path = '' as $$
declare
  previous public.ai_advisor_requests;
  claimed uuid;
  at_time timestamptz;
begin
  -- Recheck ownership with the service identity before charging the caller's quota.
  if not exists (
    select 1 from public.fields f join public.farms a on a.id = f.farm_id
    where f.id = p_field and a.user_id = p_user
  ) then
    return jsonb_build_object('state', 'not_found');
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('ai-advisor:' || p_user::text, 0));
  at_time := clock_timestamp();
  delete from public.ai_advisor_requests
    where user_id = p_user and started_at < at_time - interval '30 days';
  update public.ai_advisor_requests set answer = null
    where user_id = p_user and answer is not null and finished_at < at_time - interval '10 minutes';

  select * into previous from public.ai_advisor_requests
    where user_id = p_user and field_id = p_field and fingerprint = p_hash
      and started_at >= at_time - interval '12 minutes'
    order by started_at desc limit 1;
  if previous.answer is not null then
    return jsonb_build_object('state', 'cached', 'answer', previous.answer);
  end if;
  if previous.finished_at >= at_time - interval '30 seconds' or exists (
    select 1 from public.ai_advisor_requests
      where user_id = p_user and finished_at is null and started_at >= at_time - interval '90 seconds'
  ) then
    return jsonb_build_object('state', 'busy');
  end if;
  if (select count(*) from public.ai_advisor_requests
      where user_id = p_user and started_at >= at_time - interval '24 hours') >= 12
    or (select count(*) from public.ai_advisor_requests
      where user_id = p_user and started_at >= at_time - interval '1 minute') >= 3
  then
    return jsonb_build_object('state', 'limit');
  end if;

  insert into public.ai_advisor_requests (user_id, field_id, fingerprint)
    values (p_user, p_field, p_hash) returning id into claimed;
  return jsonb_build_object('state', 'claimed', 'id', claimed);
end;
$$;

revoke all on function public.claim_ai_advisor_request(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.claim_ai_advisor_request(uuid, uuid, text) to service_role;
