-- The assistant's keyword fallback search widened "work / career" questions with two employer
-- names written into the function. After a job change the new employer would have been missing
-- from that list, so the names now come from the work history (public.experience) at query time.
--
-- Only that one literal is replaced, in whatever body the function has today: nothing else about
-- the function, its grants or its settings changes, and running this twice does nothing.
do $$
declare
  body text;
  literal constant text := ''' experience employment Goldman CuraStone''';
  from_history constant text :=
    '(select '' experience employment '' || coalesce(string_agg(e.name, '' ''), '''') from public.experience e)';
begin
  if to_regprocedure('public.search_current_knowledge_lexical(text,integer)') is null then
    raise notice 'search_current_knowledge_lexical is not installed; nothing to change';
    return;
  end if;
  body := pg_get_functiondef('public.search_current_knowledge_lexical(text,integer)'::regprocedure);
  if position(literal in body) = 0 then
    raise notice 'search_current_knowledge_lexical no longer names employers; nothing to change';
    return;
  end if;
  execute replace(body, literal, from_history);
end $$;
