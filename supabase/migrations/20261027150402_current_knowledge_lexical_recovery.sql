-- Provider-independent recovery over current evidence only. This does not
-- expose the knowledge table or relax public source eligibility.
create or replace function public.search_current_knowledge_lexical(query_text text, match_count integer default 6)
returns table(id uuid, content text, metadata jsonb, similarity double precision)
language sql stable security invoker set search_path = '' as $$
 with normalized as (
  select left(coalesce(query_text,''),8000) ||
   case when query_text ~* '(学历|毕业|大学|学校|教育|education|degree|universit|college)' then ' education university degree Syracuse Liverpool' else '' end ||
   case when query_text ~* '(工作|经历|experience|career|employ)' then ' experience employment Goldman CuraStone' else '' end as q
 ), terms as (
  select word from normalized, unnest(tsvector_to_array(to_tsvector('pg_catalog.english',q))) word
  where word not in ('yuqi','guo','介绍','请','他','的') order by word limit 40
 ), query as (
  select string_agg(quote_literal(word),' | ')::tsquery as q from terms
 ), candidates as (
  select k.id,k.content,
   k.metadata || jsonb_build_object('answer_visibility',coalesce(k.metadata->>'answer_visibility','public'),
    'source_requires_login',case when k.metadata->>'source_type' in ('PROFILE','OWNER_QA') then true else false end) as metadata,
   ts_rank_cd(to_tsvector('pg_catalog.english',coalesce(k.metadata->>'title','') || ' ' || k.content),query.q)::double precision as similarity
  from public.kb_documents k cross join query
  where length(coalesce(query_text,'')) between 1 and 8000
   and to_tsvector('pg_catalog.english',coalesce(k.metadata->>'title','') || ' ' || k.content) @@ query.q
   and k.metadata->>'status'='ACTIVE'
   and coalesce(k.metadata->>'retrieval_eligible','true')<>'false'
   and coalesce(k.metadata->>'answer_visibility','public')='public'
   and (
    (nullif(k.metadata->>'url','') is not null and k.metadata->>'source_version' is not null and (
      (k.metadata->>'source_type'='BLOG' and exists(select 1 from public."Blogs" b where b.id::text=k.metadata->>'source_id'))
      or (k.metadata->>'source_type'='PROJECT' and exists(select 1 from public."Projects" p where p.id::text=k.metadata->>'source_id' and p.publication_status='PUBLISHED'))
      or (k.metadata->>'source_type'='LIFE_BLOG' and exists(select 1 from public.life_blogs l where l.id::text=k.metadata->>'source_id' and l.require_login=false))
      or (k.metadata->>'source_type'='EXPERIENCE' and exists(select 1 from public.experience e where e.id::text=k.metadata->>'source_id'))))
    or (k.metadata->>'source_type' in ('PROFILE','OWNER_QA')
      and k.metadata->>'evidence_review'='approved' and k.metadata->>'retrieval_eligible'='true'
      and exists(select 1 from public.kb_documents original
       where original.id::text=k.metadata->>'source_id'
        and md5(original.content)=k.metadata->>'original_content_md5'
        and (original.metadata->>'type'='chat_qa' or original.metadata->>'source'='personal_profile')))
   )
   and not exists(select 1 from public.kb_documents newer
    where newer.metadata->>'status'='ACTIVE'
     and newer.metadata->>'source_type'=k.metadata->>'source_type'
     and newer.metadata->>'source_id'=k.metadata->>'source_id'
     and coalesce((newer.metadata->>'source_version')::bigint,0)>coalesce((k.metadata->>'source_version')::bigint,0))
 ), ranked as (
  select c.*,row_number() over(partition by c.metadata->>'source_type',c.metadata->>'source_id'
   order by c.similarity desc,c.id) as source_rank from candidates c
 )
 select r.id,r.content,r.metadata,r.similarity from ranked r where r.source_rank<=4
 order by r.similarity desc,r.id limit greatest(1,least(coalesce(match_count,6),20));
$$;
revoke all on function public.search_current_knowledge_lexical(text,integer) from public,anon,authenticated;
grant execute on function public.search_current_knowledge_lexical(text,integer) to service_role;
