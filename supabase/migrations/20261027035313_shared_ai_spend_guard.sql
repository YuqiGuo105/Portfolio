begin;

create table public.ai_spend_policy (
  singleton boolean primary key default true check (singleton),
  enabled boolean not null default false,
  monthly_limit_micros bigint not null default 8000000
    check (monthly_limit_micros between 1 and 8000000)
);
insert into public.ai_spend_policy (singleton) values (true);

create table public.ai_spend_months (
  month date primary key check (extract(day from month) = 1),
  baseline_micros bigint not null default 0 check (baseline_micros >= 0),
  settled_micros bigint not null default 0 check (settled_micros >= 0)
);

create table public.ai_spend_reservations (
  id uuid primary key,
  month date not null references public.ai_spend_months(month),
  provider text not null check (provider in ('google', 'qwen')),
  operation text not null check (length(operation) between 1 and 100),
  reserved_micros bigint not null check (reserved_micros > 0),
  charged_micros bigint check (charged_micros >= 0),
  created_at timestamptz not null default clock_timestamp(),
  settled_at timestamptz,
  check ((charged_micros is null) = (settled_at is null))
);
create index ai_spend_open_reservations on public.ai_spend_reservations(month)
  where settled_at is null;

alter table public.ai_spend_policy enable row level security;
alter table public.ai_spend_months enable row level security;
alter table public.ai_spend_reservations enable row level security;
revoke all on public.ai_spend_policy, public.ai_spend_months,
  public.ai_spend_reservations from public, anon, authenticated;
grant select, insert, update on public.ai_spend_policy, public.ai_spend_months,
  public.ai_spend_reservations to service_role;

-- All environments and providers serialize on the same policy row. Open
-- reservations never expire or disappear at month rollover: unknown usage is
-- not evidence that a provider did no work.
create function public.ai_spend_guard(
  p_action text,
  p_id uuid default null,
  p_provider text default null,
  p_operation text default null,
  p_micros bigint default null
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  policy public.ai_spend_policy%rowtype;
  receipt public.ai_spend_reservations%rowtype;
  period date := date_trunc('month', clock_timestamp() at time zone 'UTC')::date;
  used bigint;
  held bigint;
  charge bigint;
begin
  if p_action not in ('status', 'reserve', 'settle') or p_action is null then
    raise exception 'Invalid budget action';
  end if;
  select * into strict policy from public.ai_spend_policy where singleton for update;
  insert into public.ai_spend_months(month) values (period) on conflict do nothing;

  if p_action = 'settle' then
    select * into strict receipt from public.ai_spend_reservations where id = p_id;
    if receipt.settled_at is not null then
      return jsonb_build_object('allowed', true, 'reason', 'already_settled');
    end if;
    if p_micros is not null and (p_micros < 0 or p_micros > 1000000000) then
      raise exception 'Invalid usage amount';
    end if;
    charge := coalesce(p_micros, receipt.reserved_micros);
    update public.ai_spend_reservations
      set charged_micros = charge, settled_at = clock_timestamp() where id = p_id;
    update public.ai_spend_months set settled_micros = settled_micros + charge
      where month = receipt.month;
    -- Late usage is charged against both accounting windows conservatively.
    if receipt.month <> period then
      update public.ai_spend_months set settled_micros = settled_micros + charge where month = period;
    end if;
    if charge > receipt.reserved_micros then
      update public.ai_spend_policy set enabled = false where singleton;
      return jsonb_build_object('allowed', false, 'reason', 'reservation_overrun');
    end if;
    return jsonb_build_object('allowed', true, 'reason', 'settled');
  end if;

  select baseline_micros + settled_micros into used from public.ai_spend_months where month = period;
  select coalesce(sum(reserved_micros), 0) into held
    from public.ai_spend_reservations where settled_at is null;
  if not policy.enabled then
    return jsonb_build_object('allowed', false, 'reason', 'disabled');
  end if;
  if p_action = 'reserve' then
    if p_id is null or p_micros is null or p_micros < 1 or p_micros > 8000000
      or p_provider is null or p_provider not in ('google', 'qwen')
      or p_operation is null or length(p_operation) not between 1 and 100 then
      raise exception 'Invalid reservation';
    end if;
    if exists(select 1 from public.ai_spend_reservations where id = p_id) then
      return jsonb_build_object('allowed', false, 'reason', 'duplicate');
    end if;
  end if;
  if used + held + (case when p_action = 'reserve' then p_micros else 1 end) > policy.monthly_limit_micros then
    return jsonb_build_object('allowed', false, 'reason', 'monthly_limit', 'remainingMicros', greatest(0, policy.monthly_limit_micros - used - held));
  end if;
  if p_action = 'reserve' then
    insert into public.ai_spend_reservations(id, month, provider, operation, reserved_micros)
      values(p_id, period, p_provider, p_operation, p_micros);
    held := held + p_micros;
  end if;
  return jsonb_build_object('allowed', true, 'reason', 'available', 'remainingMicros', policy.monthly_limit_micros - used - held);
end; $$;
revoke all on function public.ai_spend_guard(text, uuid, text, text, bigint) from public, anon, authenticated;
grant execute on function public.ai_spend_guard(text, uuid, text, text, bigint) to service_role;
commit;
