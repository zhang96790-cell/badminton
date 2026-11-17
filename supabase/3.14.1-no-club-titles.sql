-- Skyline Smash 3.14.1: local club opens don't count as titles. Run after 3.14-titles.sql. Safe to run again.
-- Club wins already on accounts (ct_club) are taken off career_titles and are worth no title points.
create or replace function public.title_points(c jsonb) returns numeric
language sql immutable set search_path = '' as $$
  select coalesce((c ->> 'ct_olympics')::numeric, 0) * 50 + coalesce((c ->> 'ct_worlds')::numeric, 0) * 35
       + coalesce((c ->> 'ct_finals')::numeric, 0) * 25 + coalesce((c ->> 'ct_s_thousand')::numeric, 0) * 18
       + coalesce((c ->> 'ct_s_seven')::numeric, 0) * 12 + coalesce((c ->> 'ct_s_five')::numeric, 0) * 8
       + coalesce((c ->> 'ct_s_three')::numeric, 0) * 5 + coalesce((c ->> 'ct_s_hundred')::numeric, 0) * 3
       + greatest(0, coalesce((c ->> 'career_titles')::numeric, 0) - (
           coalesce((c ->> 'ct_olympics')::numeric, 0) + coalesce((c ->> 'ct_worlds')::numeric, 0) + coalesce((c ->> 'ct_finals')::numeric, 0)
         + coalesce((c ->> 'ct_s_thousand')::numeric, 0) + coalesce((c ->> 'ct_s_seven')::numeric, 0) + coalesce((c ->> 'ct_s_five')::numeric, 0)
         + coalesce((c ->> 'ct_s_three')::numeric, 0) + coalesce((c ->> 'ct_s_hundred')::numeric, 0) + coalesce((c ->> 'ct_club')::numeric, 0))) * 3;
$$;
