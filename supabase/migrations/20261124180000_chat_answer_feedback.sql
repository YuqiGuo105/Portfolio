-- A visitor's verdict on one chat answer, with a frozen copy of that answer's run.
--
-- The chat window sends only the run ID and the verdict. The server reads the run from the agent
-- service (question, answer, routing, safety checks, retrieval sources, models, prompt versions,
-- tokens, timings) and stores it here as it was when rated, so the record survives any later
-- trimming of the agent's own history. One row per run: a changed verdict replaces the earlier
-- one, and taking a rating back deletes the row.
--
-- RLS is on with no policies: only the server's service-role client reads or writes here.
create table if not exists public.chat_answer_feedback (
  run_id uuid primary key,
  verdict text not null check (verdict in ('up', 'down')),
  session_id text not null check (char_length(session_id) between 8 and 80),
  conversation_id text check (conversation_id is null or char_length(conversation_id) <= 120),
  question text not null check (char_length(question) between 1 and 8000),
  answer text not null check (char_length(answer) between 1 and 60000),
  route text,
  status text,
  latency_ms integer check (latency_ms is null or latency_ms >= 0),
  models text[] not null default '{}',
  prompt_versions text[] not null default '{}',
  source_count integer not null default 0 check (source_count >= 0),
  cost_usd numeric(12, 6) check (cost_usd is null or cost_usd >= 0),
  page_path text check (page_path is null or char_length(page_path) <= 200),
  answered_at timestamptz,
  run jsonb not null check (jsonb_typeof(run) = 'object' and pg_column_size(run) <= 524288),
  rated_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists chat_answer_feedback_recent on public.chat_answer_feedback (updated_at desc);
create index if not exists chat_answer_feedback_by_verdict on public.chat_answer_feedback (verdict, updated_at desc);

alter table public.chat_answer_feedback enable row level security;
revoke all on public.chat_answer_feedback from anon, authenticated;
grant select, insert, update, delete on public.chat_answer_feedback to service_role;
