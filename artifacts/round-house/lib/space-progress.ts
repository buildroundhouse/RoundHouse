/** Every completed working context must be backed by an approved Entity membership. */
export function needsEntityMembership(kind?: string): boolean {
  return !!kind;
}

export type IntakeEntity = {
  myMembership?: { status?: string; archivedAt?: unknown } | null;
};

export function hasApprovedEntity(entities?: IntakeEntity[]): boolean {
  return !!entities?.some((entity) =>
    entity.myMembership?.status === "approved" && !entity.myMembership.archivedAt,
  );
}
