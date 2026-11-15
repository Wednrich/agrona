-- Registration invokes this function through existing auth.users triggers.
-- API clients must never invoke privileged trigger code directly.
-- Keep SECURITY DEFINER and the empty search_path required by the trigger.
revoke execute on function public.handle_signup() from public, anon, authenticated;
