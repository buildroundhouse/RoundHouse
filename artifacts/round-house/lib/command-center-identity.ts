import { profileContext, type ProfileEntity } from "./personal-profile";
type Account = { kind: string; companyName?: string | null; sourceUserModeId?: number | null };
type Mode = { id: number; kind: string; intakeData?: unknown };
export function commandCenterIdentity(account: Account | null, mode: Mode | null, entities: ProfileEntity[] = []) {
  const md = (mode?.intakeData ?? {}) as Record<string, unknown>;
  const kind = account?.kind ?? mode?.kind;
  const context = profileContext(kind, md, entities);
  const homes = context.memberships.filter(e => e.kind === "property");
  const combined = kind === "home" && homes.length > 1;
  return {
    entityName: combined ? "My Homes / Properties" : context.entityName,
    roleLabel: context.role,
  };
}
