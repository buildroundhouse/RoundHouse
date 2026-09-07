// Shared helper for the "<account name> · <kind label>" pattern used on
// every profile surface (account switcher, public profile, full profile,
// search results, find screen, home identity row).
//
// #618 introduced overlap-aware subtitle handling inside
// OutwardAccountSwitcher so a "My Home" / "Smith Home" home account
// wouldn't visually duplicate as "Smith Home · My Home" → "Home Home"
// when truncated. #620 generalises the rule and lifts it here so every
// caller behaves identically: the kind label is suppressed whenever the
// name already contains every word of the label (case-insensitive,
// whole-word matches).

const WORD_RE = /\b[\w']+\b/g;

function wordSet(s: string): Set<string> {
  const matches = s.toLowerCase().match(WORD_RE);
  return new Set(matches ?? []);
}

/**
 * Returns true when the kind label should be hidden because every word in
 * it already appears (whole-word, case-insensitive) in the visible name.
 *
 * Examples:
 *   nameContainsKindLabel("My Home", "My Home")        -> true
 *   nameContainsKindLabel("Smith Home", "My Home")     -> false  (missing "my")
 *   nameContainsKindLabel("Smith Home", "Home")        -> true
 *   nameContainsKindLabel("Acme Plumbing", "Trade Pro")-> false
 */
export function nameContainsKindLabel(
  name: string | null | undefined,
  kindLabel: string | null | undefined,
): boolean {
  if (!kindLabel) return false;
  const labelWords = kindLabel.toLowerCase().match(WORD_RE) ?? [];
  if (labelWords.length === 0) return false;
  const nameWords = wordSet(name ?? "");
  return labelWords.every((w) => nameWords.has(w));
}

/**
 * Returns the kind label to render under (or after) `name`, or null if it
 * should be suppressed because the name already conveys it.
 */
export function kindLabelForName(
  name: string | null | undefined,
  kindLabel: string | null | undefined,
): string | null {
  if (!kindLabel) return null;
  return nameContainsKindLabel(name, kindLabel) ? null : kindLabel;
}
