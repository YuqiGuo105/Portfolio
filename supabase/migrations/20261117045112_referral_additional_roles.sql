-- Keep the primary role columns for old requests and clients. No new grants or RLS policies.
alter table public.referral_requests
  add column additional_roles jsonb not null default '[]'::jsonb
  constraint referral_requests_additional_roles_check check (
    jsonb_typeof(additional_roles) = 'array'
    and jsonb_array_length(additional_roles) <= 2
    and not jsonb_path_exists(additional_roles, 'strict $[*] ? (@.type() != "object")')
  );
