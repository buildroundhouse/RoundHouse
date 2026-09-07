/**
 * Single source of truth for the order skins are rendered in the
 * account switcher and any other surface that lists outward-account
 * kinds. Used by:
 *   - artifacts/api-server/src/lib/outwardAccounts.ts (server-side
 *     row sort returned to the switcher)
 *   - artifacts/round-house/components/ModeSwitcher.tsx (client-side
 *     "Add account" picker order)
 *
 * Lower numbers render first. Legacy `trade_pro_collab` and
 * `facilities_collab` kinds collapse into the Collaborator slot at
 * the end alongside the canonical `collab` kind.
 *
 * Kept in `@workspace/api-zod` because it is the only typed package
 * already shared by both the API server and the Expo client without
 * dragging in the Postgres pool from `@workspace/db`.
 */
export const USER_MODE_KIND_ORDER: Record<string, number> = {
  home: 1,
  home_teammate: 2,
  trade_pro: 3,
  trade_pro_teammate: 4,
  facilities: 5,
  facilities_teammate: 6,
  collab: 7,
  trade_pro_collab: 7,
  facilities_collab: 7,
};

export function compareUserModeKind(a: string, b: string): number {
  const ao = USER_MODE_KIND_ORDER[a] ?? 99;
  const bo = USER_MODE_KIND_ORDER[b] ?? 99;
  return ao - bo;
}
