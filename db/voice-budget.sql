-- Private, durable platform-wide voice allowance. No audio or transcripts.
create table public.voice_budget (
  singleton boolean primary key default true check (singleton),
  enabled boolean not null default false,
  usage_day date not null default (now() at time zone 'America/Denver')::date,
  daily_calls integer not null default 0 check (daily_calls >= 0),
  usage_month text not null default to_char(now() at time zone 'America/Denver', 'YYYY-MM'),
  monthly_calls integer not null default 0 check (monthly_calls >= 0),
  ticket_hash text,
  claim_by timestamptz,
  active_until timestamptz,
  claimed boolean not null default false
);
alter table public.voice_budget enable row level security;
revoke all on public.voice_budget from public, anon, authenticated;
grant select, insert, update on public.voice_budget to service_role;
insert into public.voice_budget (singleton) values (true);

create or replace function public.voice_allowance(p_action text, p_ticket_hash text default null)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  b public.voice_budget%rowtype;
  t timestamptz := clock_timestamp();
  d date := (t at time zone 'America/Denver')::date;
  m text := to_char(t at time zone 'America/Denver', 'YYYY-MM');
  why text;
begin
  if p_action not in ('status', 'reserve', 'claim', 'release') then
    raise exception 'Invalid voice operation';
  end if;
  select * into strict b from public.voice_budget where singleton for update;
  if b.usage_day <> d then b.usage_day := d; b.daily_calls := 0; end if;
  if b.usage_month <> m then b.usage_month := m; b.monthly_calls := 0; end if;
  if p_action <> 'status' and (p_ticket_hash is null or p_ticket_hash !~ '^[a-f0-9]{64}$') then
    raise exception 'Invalid voice ticket';
  end if;
  if p_action = 'release' then
    if b.ticket_hash = p_ticket_hash then b.active_until := null; b.ticket_hash := null; b.claimed := false; end if;
  elsif p_action = 'claim' then
    if not b.enabled or b.ticket_hash is distinct from p_ticket_hash or b.claimed or b.claim_by <= t then
      return jsonb_build_object('allowed', false, 'reason', 'invalid_ticket');
    end if;
    b.claimed := true;
    b.active_until := t + interval '120 seconds';
  else
    why := case when not b.enabled then 'disabled'
      when b.daily_calls >= 5 then 'daily_limit'
      when b.monthly_calls >= 40 then 'monthly_limit'
      when b.active_until > t then 'busy' else null end;
    if p_action = 'reserve' and why is null then
      b.daily_calls := b.daily_calls + 1;
      b.monthly_calls := b.monthly_calls + 1;
      b.ticket_hash := p_ticket_hash;
      b.claim_by := t + interval '30 seconds';
      b.active_until := b.claim_by;
      b.claimed := false;
    end if;
  end if;
  update public.voice_budget set enabled = b.enabled, usage_day = b.usage_day,
    daily_calls = b.daily_calls, usage_month = b.usage_month, monthly_calls = b.monthly_calls,
    ticket_hash = b.ticket_hash, claim_by = b.claim_by, active_until = b.active_until, claimed = b.claimed
    where singleton;
  return jsonb_build_object('allowed', why is null, 'reason', why,
    'remainingCalls', greatest(0, least(5 - b.daily_calls, 40 - b.monthly_calls)),
    'expiresAt', b.active_until,
    'resetAt', ((d + 1)::timestamp at time zone 'America/Denver'));
end;
$$;
revoke all on function public.voice_allowance(text, text) from public, anon, authenticated;
grant execute on function public.voice_allowance(text, text) to service_role;
