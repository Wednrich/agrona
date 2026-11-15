-- Run after migrations in a disposable Supabase database.
begin;
insert into auth.users(id, email, raw_user_meta_data, email_confirmed_at) values
  ('a1111111-1111-4111-8111-111111111111', 'advisor-owner@test.invalid', '{}', now()),
  ('b2222222-2222-4222-8222-222222222222', 'advisor-other@test.invalid', '{}', now());
insert into public.farms(id,user_id,name) values
  ('a3333333-3333-4333-8333-333333333333','a1111111-1111-4111-8111-111111111111','Advisor farm');
insert into public.fields(id,farm_id,name,boundary,area_hectares) values
  ('a4444444-4444-4444-8444-444444444444','a3333333-3333-4333-8333-333333333333','Advisor field',
   extensions.st_geomfromtext('POLYGON((70 51,70.01 51,70.01 51.01,70 51))',4326),1);

do $$ begin
  if has_function_privilege('anon', 'public.claim_ai_advisor_request(uuid,uuid,text)', 'execute')
    or has_function_privilege('authenticated', 'public.claim_ai_advisor_request(uuid,uuid,text)', 'execute')
    or has_table_privilege('authenticated', 'public.ai_advisor_requests', 'select,insert,update,delete')
  then raise exception 'Non-service role has access to advisor quota or cache'; end if;
end $$;

set local role service_role;
do $$
declare
  owner_id uuid := 'a1111111-1111-4111-8111-111111111111';
  other_id uuid := 'b2222222-2222-4222-8222-222222222222';
  field_id uuid := 'a4444444-4444-4444-8444-444444444444';
  lease jsonb;
begin
  if public.claim_ai_advisor_request(other_id,field_id,repeat('x',64))->>'state' <> 'not_found'
    then raise exception 'Claim allowed for a field the user does not own'; end if;
  lease := public.claim_ai_advisor_request(owner_id,field_id,repeat('a',64));
  if lease->>'state' <> 'claimed' then raise exception 'First request was not accepted'; end if;
  if public.claim_ai_advisor_request(owner_id,field_id,repeat('b',64))->>'state' <> 'busy'
    then raise exception 'In-flight request did not block another claim'; end if;
  update public.ai_advisor_requests set finished_at=now(), answer='{"summary":"cached"}'::jsonb,
    prompt_tokens=11, completion_tokens=3 where id=(lease->>'id')::uuid;
  if public.claim_ai_advisor_request(owner_id,field_id,repeat('a',64))->'answer'->>'summary' <> 'cached'
    then raise exception 'Identical request did not reuse the cached answer'; end if;

  insert into public.ai_advisor_requests(user_id,field_id,fingerprint,started_at,finished_at)
    values (owner_id,field_id,repeat('b',64),now(),now()), (owner_id,field_id,repeat('c',64),now(),now());
  if public.claim_ai_advisor_request(owner_id,field_id,repeat('d',64))->>'state' <> 'limit'
    then raise exception 'Minute rate limit failed'; end if;

  update public.ai_advisor_requests r set started_at=now()-interval '2 minutes'
    where r.user_id=owner_id;
  insert into public.ai_advisor_requests(user_id,field_id,fingerprint,started_at,finished_at)
    select owner_id,field_id,repeat('e',64),now()-interval '2 minutes',now()-interval '2 minutes'
    from generate_series(1, 9);
  if public.claim_ai_advisor_request(owner_id,field_id,repeat('d',64))->>'state' <> 'limit'
    then raise exception 'Rolling daily rate limit failed'; end if;
end $$;
rollback;
