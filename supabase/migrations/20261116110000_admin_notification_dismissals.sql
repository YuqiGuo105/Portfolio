-- Notifications the owner cleared from the bell in the admin top bar. A cleared notification is
-- gone for good on every device: its key is kept here so the same item is never listed again.
-- The item itself (a referral request, a failed job, an alert) is not touched.
--
-- RLS is on with no policies: only the server's service-role client reads or writes here.
create table if not exists public.admin_notification_dismissals (
  key text primary key check (char_length(key) between 3 and 200),
  dismissed_at timestamptz not null default now()
);
alter table public.admin_notification_dismissals enable row level security;
revoke all on public.admin_notification_dismissals from anon, authenticated;
grant select, insert, delete on public.admin_notification_dismissals to service_role;
