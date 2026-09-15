/** Personal identity completion is independent of any property/business intake. */
export function hasSavedIdentity(profile: { identityCompletedAt?: unknown } | null | undefined): boolean {
  return Boolean(profile?.identityCompletedAt);
}

export function afterIdentityRoute(mode: { id: number; kind: string; intakeCompletedAt?: unknown } | null) {
  if (!mode || mode.kind === "collab") return { pathname: "/(onboarding)/entry" as const };
  if (mode.intakeCompletedAt) return { pathname: "/(tabs)" as const };
  return { pathname: "/(onboarding)/entry" as const };
}
