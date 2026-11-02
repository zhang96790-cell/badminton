// Username rules shared by the game, the account sign-up and the room server.

/** Lowercase letters, numbers and underscores, 3–16 long. */
export const NAME_PATTERN = /^[a-z0-9_]{3,16}$/;

// Word stems that aren't allowed anywhere in a username (checked with separators and digits removed,
// so "b_a_d"-style spacing doesn't slip through). Kept to words that don't hide inside ordinary names
// (no "sex" for Essex, "cock" for peacock, "dick" for Dickson).
const BLOCKED = [
  'fuck', 'shit', 'cunt', 'bitch', 'pussy', 'penis', 'vagina', 'porn', 'nigg', 'fag', 'retard',
  'nazi', 'hitler', 'whore', 'slut', 'wank', 'twat', 'bastard', 'asshole', 'killyourself',
];

/** Would this (already lowercased) username be offensive? */
export function isOffensive(name: string): boolean {
  const squashed = name.toLowerCase().replace(/[^a-z]/g, '');
  return BLOCKED.some((w) => squashed.includes(w));
}

/** A name safe to show other players: the username if it's allowed, otherwise a guest name. */
export function displayName(name: string | null | undefined, fallback: string): string {
  const n = (name ?? '').trim().toLowerCase();
  return NAME_PATTERN.test(n) && !isOffensive(n) ? n : fallback;
}
