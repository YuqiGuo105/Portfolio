-- Globe guestbook: flags visitors plant on the visitor globe (pages/api/globe/flags.js).
-- Emoji-only flags are stored approved; a flag with a note waits for review in /admin/globe-flags.
-- RLS is on with no policies: only the server's service-role client reads or writes this table.

create table if not exists public.globe_flags (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  lat double precision not null check (lat between -90 and 90),
  lng double precision not null check (lng between -180 and 180),
  city text check (city is null or char_length(city) <= 80),
  country text check (country is null or char_length(country) <= 2),
  emoji text not null check (char_length(emoji) <= 8),
  message text check (message is null or char_length(message) <= 60),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  reviewed_at timestamptz,
  ip_hash text
);

create index if not exists globe_flags_status_created_idx
  on public.globe_flags (status, created_at desc);

alter table public.globe_flags enable row level security;
revoke all on public.globe_flags from anon, authenticated;
