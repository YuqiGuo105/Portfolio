-- Referral requests sent from /talk and reviewed in /admin/referrals (docs/REFERRAL_REQUESTS.md).
--
-- This table is both the record and the work queue. A request is accepted with one insert
-- (idempotent on idempotency_key), its résumé is uploaded by the browser to the private
-- "referral-resumes" storage bucket, and a worker claims queued rows in batches with a lease, so
-- any number of workers can run at once without screening a request twice.
--
-- RLS is on with no policies: only the server's service-role client reads or writes here.

create table if not exists public.referral_requests (
  id uuid primary key default gen_random_uuid(),
  idempotency_key uuid not null unique,
  reference text not null unique check (char_length(reference) <= 16),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- The request is removed after 180 days; its résumé file after 30, or as soon as it is closed.
  expires_at timestamptz not null default now() + interval '180 days',
  resume_expires_at timestamptz not null default now() + interval '30 days',
  -- Pipeline: waiting for the file, waiting for the worker, being screened, ready, or file refused.
  state text not null default 'awaiting_upload' check (state in ('awaiting_upload', 'queued', 'screening', 'ready', 'file_rejected')),
  -- The owner's decision.
  status text not null default 'new' check (status in ('new', 'reviewing', 'referred', 'declined', 'archived')),
  name text not null check (char_length(name) <= 120),
  email text not null check (char_length(email) <= 320),
  profile_url text check (profile_url is null or char_length(profile_url) <= 300),
  -- The employer the request is for: the current one in the work history when it was sent. Kept
  -- on the row so a later job change does not relabel old requests.
  company text not null check (char_length(company) between 1 and 160),
  role_title text not null check (char_length(role_title) <= 140),
  job_url text not null check (char_length(job_url) <= 500),
  job_id text check (job_id is null or char_length(job_id) <= 60),
  location text check (location is null or char_length(location) <= 100),
  requirements text check (requirements is null or char_length(requirements) <= 1500),
  relationship text not null check (relationship in ('worked_together', 'school', 'met', 'introduced', 'not_yet')),
  relationship_note text check (relationship_note is null or char_length(relationship_note) <= 300),
  current_title text check (current_title is null or char_length(current_title) <= 140),
  years_experience smallint check (years_experience is null or years_experience between 0 and 60),
  -- Written by the applicant, in third person. Never generated or rewritten.
  intro text not null check (char_length(intro) <= 1500),
  why_role text check (why_role is null or char_length(why_role) <= 800),
  -- Object path in the storage bucket; null once the file has been deleted.
  resume_path text check (resume_path is null or char_length(resume_path) <= 120),
  resume_filename text check (resume_filename is null or char_length(resume_filename) <= 80),
  resume_bytes integer check (resume_bytes is null or resume_bytes between 1 and 2097152),
  resume_sha256 text check (resume_sha256 is null or char_length(resume_sha256) = 64),
  -- The screening note shown to the owner (src/lib/referral/screening.mjs). Never returned to applicants.
  screening jsonb not null default '{}'::jsonb,
  recommendation text check (recommendation is null or recommendation in ('strong', 'promising', 'unclear', 'weak')),
  fit smallint check (fit is null or fit between 0 and 100),
  lease_until timestamptz,
  attempts smallint not null default 0,
  notified_at timestamptz,
  owner_note text check (owner_note is null or char_length(owner_note) <= 2000)
);

create index if not exists referral_requests_status_created_idx on public.referral_requests (status, created_at desc);
create index if not exists referral_requests_expiry_idx on public.referral_requests (expires_at);
-- The queue: small partial indexes, so claiming stays fast however large the table grows.
create index if not exists referral_requests_queue_idx on public.referral_requests (created_at) where state in ('queued', 'screening');
create index if not exists referral_requests_unnotified_idx on public.referral_requests (created_at) where notified_at is null and state in ('ready', 'file_rejected');
create index if not exists referral_requests_files_idx on public.referral_requests (resume_expires_at) where resume_path is not null;

alter table public.referral_requests enable row level security;
revoke all on public.referral_requests from anon, authenticated;
grant select, insert, update, delete on public.referral_requests to service_role;

-- Claim up to batch_size requests for screening. SKIP LOCKED lets concurrent workers each take
-- different rows; a claim whose lease has run out (the worker died) is taken again, up to 5 attempts.
create or replace function public.claim_referral_screenings(batch_size integer, lease_seconds integer)
returns setof public.referral_requests language sql security invoker set search_path = '' as $$
  update public.referral_requests r
     set state = 'screening', lease_until = now() + make_interval(secs => greatest(lease_seconds, 10)), attempts = r.attempts + 1
   where r.id in (
     select q.id from public.referral_requests q
      where q.attempts < 5 and (q.state = 'queued' or (q.state = 'screening' and q.lease_until < now()))
      order by q.created_at
      limit least(greatest(batch_size, 1), 20)
      for update skip locked)
  returning r.*;
$$;

-- One row of shared state: how many digest emails have gone out this hour, and whether new
-- requests are being accepted (the owner's switch on /admin/referrals).
create table if not exists public.referral_notify_state (
  singleton boolean primary key default true check (singleton),
  window_start timestamptz not null default now(),
  sent integer not null default 0,
  accepting boolean not null default true
);
insert into public.referral_notify_state (singleton) values (true) on conflict do nothing;
alter table public.referral_notify_state enable row level security;
revoke all on public.referral_notify_state from anon, authenticated;
grant select, insert, update on public.referral_notify_state to service_role;

-- Take the requests for one digest email and mark them notified. Returns nothing when there is
-- nothing new, or when this hour's allowance of emails is used up; the rows then wait for the next one.
create or replace function public.claim_referral_digest(max_per_hour integer, max_rows integer)
returns setof public.referral_requests language plpgsql security invoker set search_path = '' as $$
begin
  if not exists (select 1 from public.referral_requests where notified_at is null and state in ('ready', 'file_rejected')) then
    return;
  end if;
  update public.referral_notify_state s
     set window_start = case when s.window_start <= now() - interval '1 hour' then now() else s.window_start end,
         sent = case when s.window_start <= now() - interval '1 hour' then 1 else s.sent + 1 end
   where s.singleton and (s.window_start <= now() - interval '1 hour' or s.sent < greatest(max_per_hour, 1));
  if not found then
    return;
  end if;
  return query
    update public.referral_requests r set notified_at = now()
     where r.id in (
       select q.id from public.referral_requests q
        where q.notified_at is null and q.state in ('ready', 'file_rejected')
        order by q.created_at
        limit least(greatest(max_rows, 1), 100)
        for update skip locked)
    returning r.*;
end $$;

revoke all on function public.claim_referral_screenings(integer, integer) from public, anon, authenticated;
revoke all on function public.claim_referral_digest(integer, integer) from public, anon, authenticated;
grant execute on function public.claim_referral_screenings(integer, integer) to service_role;
grant execute on function public.claim_referral_digest(integer, integer) to service_role;
