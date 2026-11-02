-- Public (anon) and signed-in (authenticated) access to the site's tables, defined from scratch.
--
-- Found on 2026-11-01 with the public anon key: draft and archived Projects, the full text of a
-- login-only life blog, every visitor_clicks row (IP, user agent, coordinates) and cv_comments
-- author emails were all readable. This migration drops every policy these two roles had on the
-- tables below, revokes their privileges, and grants back only what the site reads in the browser:
--
--   Projects            read published rows only
--   project_subsystems  read active rows of published projects
--   Blogs, experience   read all rows
--   life_blogs          read listing fields for every post; the body only through
--                       life_blog_content(id), which returns login-only bodies to signed-in users
--   cv_content          read; the owner inserts / updates
--   cv_comments         read approved comments without author emails; anyone adds one; the owner deletes
--   visitor_clicks      nothing (server-side service role only)
--
-- The service role (server code, admin console, backend services) bypasses RLS and keeps its grants.
-- Safe to run more than once.

do $$
declare
  t text;
  p record;
begin
  foreach t in array array['Projects', 'project_subsystems', 'Blogs', 'experience', 'life_blogs',
                           'cv_content', 'cv_comments', 'visitor_clicks'] loop
    if to_regclass(format('public.%I', t)) is null then
      raise notice 'skipping missing table %', t;
      continue;
    end if;
    for p in
      select policyname from pg_policies
      where schemaname = 'public' and tablename = t
        and roles && array['public', 'anon', 'authenticated']::name[]
    loop
      execute format('drop policy %I on public.%I', p.policyname, t);
    end loop;
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
  end loop;
end $$;

-- Projects: published only (drafts and archived rows stay server-side).
grant select on public."Projects" to anon, authenticated;
create policy "Published projects are public" on public."Projects"
  for select to anon, authenticated
  using (publication_status = 'PUBLISHED');

-- project_subsystems: the active subsystems of published projects.
grant select on public.project_subsystems to anon, authenticated;
create policy "Subsystems of published projects are public" on public.project_subsystems
  for select to anon, authenticated
  using (active and exists (
    select 1 from public."Projects" p
    where p.id = project_subsystems.project_id and p.publication_status = 'PUBLISHED'));

-- Blogs and experience: public as a whole.
grant select on public."Blogs" to anon, authenticated;
create policy "Tech blogs are public" on public."Blogs"
  for select to anon, authenticated using (true);

grant select on public.experience to anon, authenticated;
create policy "Experience is public" on public.experience
  for select to anon, authenticated using (true);

-- life_blogs: every post is listed (title, cover, description), but anonymous visitors cannot read
-- the content column at all; bodies come from life_blog_content(), which checks require_login.
grant select (id, title, image_url, category, published_at, description, require_login,
              created_at, updated_at, tags)
  on public.life_blogs to anon;
grant select on public.life_blogs to authenticated;
create policy "Life blog listings are public" on public.life_blogs
  for select to anon, authenticated using (true);

create or replace function public.life_blog_content(post_id integer)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select l.content
  from public.life_blogs l
  where l.id = post_id
    and (not coalesce(l.require_login, false) or (select auth.uid()) is not null)
$$;
revoke all on function public.life_blog_content(integer) from public;
grant execute on function public.life_blog_content(integer) to anon, authenticated;

-- cv_content: the CV is public; only the owner edits it.
grant select on public.cv_content to anon, authenticated;
grant insert, update on public.cv_content to authenticated;
create policy "CV is public" on public.cv_content
  for select to anon, authenticated using (true);
create policy "Owner can add the CV" on public.cv_content
  for insert to authenticated
  with check ((auth.jwt() ->> 'email') = 'yuqi.guo17@gmail.com');
create policy "Owner can edit the CV" on public.cv_content
  for update to authenticated
  using ((auth.jwt() ->> 'email') = 'yuqi.guo17@gmail.com')
  with check ((auth.jwt() ->> 'email') = 'yuqi.guo17@gmail.com');

-- cv_comments: approved comments are public without the author's email; anyone can add one
-- (approval, id and timestamps keep their defaults); the owner can delete.
grant select (id, content, author_name, is_approved, created_at, anno_id, quote, occurrence_index)
  on public.cv_comments to anon, authenticated;
grant insert (author_name, author_email, content, anno_id, quote, occurrence_index)
  on public.cv_comments to anon, authenticated;
grant delete on public.cv_comments to authenticated;
create policy "Approved CV comments are public" on public.cv_comments
  for select to anon, authenticated using (is_approved = true);
create policy "Visitors can add CV comments" on public.cv_comments
  for insert to anon, authenticated with check (true);
create policy "Owner can delete CV comments" on public.cv_comments
  for delete to authenticated
  using ((auth.jwt() ->> 'email') = 'yuqi.guo17@gmail.com');

-- visitor_clicks: raw visitor data is written and read by the server only (no grants, no policies).
