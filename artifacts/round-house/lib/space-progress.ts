/** Legacy personal/viewer profiles do not establish participation in a space. */
export function needsEntityMembership(kind?: string): boolean {
  return !!kind && (kind === "collab" || kind.endsWith("_collab") || kind.endsWith("_teammate"));
}

export type IntakeEntity = {
  myMembership?: { status?: string; archivedAt?: unknown } | null;
};

export function hasApprovedEntity(entities?: IntakeEntity[]): boolean {
  return !!entities?.some((entity) =>
    entity.myMembership?.status === "approved" && !entity.myMembership.archivedAt,
  );
}
