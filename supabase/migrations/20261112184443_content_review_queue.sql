-- Private review workflow. No browser role may read submissions or audit identities.
create table if not exists public.content_review_queue (
  id uuid primary key,
  fingerprint text not null unique check (length(fingerprint) = 64),
  channel text not null check (channel in ('contact', 'chat')),
  text text not null check (length(text) between 1 and 6000),
  context jsonb not null default '{}'::jsonb,
  reason text not null,
  risk integer check (risk between 0 and 100),
  model text not null,
  status text not null default 'pending' check (status in ('pending','releasing','sent','reviewed','rejected','delivery_unknown')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '30 days',
  audit jsonb not null default '[]'::jsonb
);
alter table public.content_review_queue enable row level security;
revoke all on public.content_review_queue from anon, authenticated;
grant select, insert, update, delete on public.content_review_queue to service_role;
create index if not exists content_review_queue_pending on public.content_review_queue(status, created_at desc);
create index if not exists content_review_queue_expiry on public.content_review_queue(expires_at);

create or replace function public.review_content_transition(item_id uuid, expected_status text, next_status text, actor_id text)
returns setof public.content_review_queue language plpgsql security invoker set search_path = '' as $$
begin
  if not ((expected_status = 'pending' and next_status in ('releasing','rejected'))
       or (expected_status = 'releasing' and next_status in ('sent','reviewed','delivery_unknown'))) then
    raise exception 'Invalid review transition';
  end if;
  return query update public.content_review_queue set status = next_status,
    audit = audit || jsonb_build_array(jsonb_build_object('actor', actor_id, 'action', next_status, 'at', now()))
    where id = item_id and status = expected_status and expires_at > now() returning *;
end $$;
revoke all on function public.review_content_transition(uuid,text,text,text) from public, anon, authenticated;
grant execute on function public.review_content_transition(uuid,text,text,text) to service_role;
