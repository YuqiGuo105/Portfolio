-- Referral requests: one request per person, the screening outcome, and the pass emails
-- (docs/REFERRAL_REQUESTS.md). Additive; the existing service-only access and RLS are unchanged.

alter table public.referral_requests
  -- "<company>|<mailbox>", folded so one mailbox written differently is still one applicant
  -- (src/lib/referral/fields.mjs, applicantKey). Null on rows that predate this.
  add column if not exists applicant_key text check (applicant_key is null or char_length(applicant_key) <= 500),
  -- What screening concluded: passed, auto_declined (scored under the bar), or review (waits for the owner).
  add column if not exists outcome text check (outcome is null or outcome in ('passed', 'auto_declined', 'review')),
  -- When the outcome was mailed: the pair for a pass, the decline for a request under the bar.
  add column if not exists outcome_mail_at timestamptz;

-- Requests already in the table keep their place: the newest one per person and company gets the
-- key, so the index below can be built even if someone asked twice before this rule existed.
update public.referral_requests r
   set applicant_key = lower(regexp_replace(btrim(r.company), '\s+', ' ', 'g')) || '|' || lower(btrim(r.email))
 where r.applicant_key is null
   and not exists (
     select 1 from public.referral_requests n
      where lower(n.email) = lower(r.email) and lower(n.company) = lower(r.company)
        and (n.created_at, n.id) > (r.created_at, r.id));

-- One request per person and company. Enforced here, so two simultaneous submissions cannot both land.
create unique index if not exists referral_requests_applicant_idx on public.referral_requests (applicant_key) where applicant_key is not null;
-- The same résumé file under another address.
create index if not exists referral_requests_resume_hash_idx on public.referral_requests (resume_sha256) where resume_sha256 is not null;
-- Outcomes whose emails are still to be sent: a handful of rows at most.
create index if not exists referral_requests_pass_mail_idx on public.referral_requests (created_at) where outcome in ('passed', 'auto_declined') and outcome_mail_at is null;
