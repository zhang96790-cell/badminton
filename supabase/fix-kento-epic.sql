-- One-off fix (16 Nov 2026): remove the Epic player kento_momota_fan got from a glitch.
-- Step 1 (optional): run this select on its own first to see which Epic players he owns.
select o.character_id, c.name, c.rarity, o.source, o.created_at
from public.owned_characters o
join public.profiles p on p.id = o.user_id
join public.characters c on c.id = o.character_id
where p.username = 'kento_momota_fan' and c.rarity = 'epic'
order by o.created_at;

-- Step 2: remove them from his career squad (and put him back on the default player if he was playing as one),
-- then remove them from his collection.
update public.career_saves s
set state = jsonb_set(
      jsonb_set(s.state, '{squad}', coalesce((select jsonb_agg(x) from jsonb_array_elements(s.state->'squad') x
        where x #>> '{}' not in (select id from public.characters where rarity = 'epic')), '[]'::jsonb)),
      '{characterId}',
      case when s.state->>'characterId' in (select id from public.characters where rarity = 'epic')
        then '"default_player"'::jsonb else s.state->'characterId' end),
    rev = s.rev + 1, updated_at = now()
from public.profiles p
where p.id = s.user_id and p.username = 'kento_momota_fan';

delete from public.owned_characters o
using public.profiles p, public.characters c
where p.id = o.user_id and c.id = o.character_id
  and p.username = 'kento_momota_fan' and c.rarity = 'epic';
