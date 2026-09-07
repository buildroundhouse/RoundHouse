/**
 * Task #663 — auto-cast resolver.
 *
 * Given an inviter avatar (outward_account) and a target avatar (or
 * target entity), returns the host entity, the role for the joining
 * avatar, and the direction. The caller of an entity-membership
 * endpoint never sends a role — the resolver is the single place
 * that decides it.
 *
 * The role taxonomy lives on `entity_members`:
 *   - owner / admin / manager / employee / worker / collaborator
 *
 * Direction:
 *   - "invite"  — inviter (or controller) brings someone into their entity
 *   - "request" — joiner asks to be let into someone else's entity
 *
 * For peer pairs that have two valid directions (pro ↔ pro), the
 * default is "tapper invites target into tapper's entity" — i.e. an
 * invite from the current avatar's perspective.
 */
import type { UserModeKind, EntityKind, EntityMemberRole } from "@workspace/db";

export interface AutoCastInput {
  /** The avatar doing the action (the tapper). */
  inviterAvatarKind: UserModeKind;
  /** The avatar being added. */
  targetAvatarKind: UserModeKind;
  /** The entity the target is being added to. */
  entityKind: EntityKind;
  /** Optional intent flag: "request" forces the inverse direction. */
  intent?: "invite" | "request";
}

export interface AutoCastResult {
  role: EntityMemberRole;
  direction: "invite" | "request";
}

const HOMEOWNER_KINDS = new Set<UserModeKind>(["home", "home_teammate"]);
const PRO_KINDS = new Set<UserModeKind>(["trade_pro", "trade_pro_teammate"]);
const FACILITY_KINDS = new Set<UserModeKind>([
  "facilities",
  "facilities_teammate",
]);
const COLLAB_KINDS = new Set<UserModeKind>([
  "trade_pro_collab",
  "facilities_collab",
  "collab",
]);

function isHome(k: UserModeKind): boolean {
  return HOMEOWNER_KINDS.has(k);
}
function isPro(k: UserModeKind): boolean {
  return PRO_KINDS.has(k);
}
function isFacility(k: UserModeKind): boolean {
  return FACILITY_KINDS.has(k);
}
function isCollab(k: UserModeKind): boolean {
  return COLLAB_KINDS.has(k);
}

/**
 * Resolve the role + direction for the membership the inviter is
 * about to write. Throws when the pairing is unsupported (caller
 * surfaces a 400). Never picks role from the request body.
 */
export function autoCastMembership(input: AutoCastInput): AutoCastResult {
  const { inviterAvatarKind, targetAvatarKind, entityKind, intent } = input;
  const direction: "invite" | "request" = intent ?? "invite";

  // Property entity (residential or commercial). Homeowner / facility
  // is the controller; everyone else joins as worker (pro), employee
  // (facility teammate), or collaborator (collab kinds).
  if (
    entityKind === "residential_property" ||
    entityKind === "commercial_property"
  ) {
    if (isHome(targetAvatarKind) || isFacility(targetAvatarKind)) {
      // Adding another homeowner/facility manager to a property =
      // co-owner-style admin role.
      return { role: "admin", direction };
    }
    if (isPro(targetAvatarKind)) {
      return { role: "worker", direction };
    }
    if (isCollab(targetAvatarKind)) {
      return { role: "collaborator", direction };
    }
  }

  // Business entity. Founder is owner; teammates join as employee;
  // outside pros / collabs join as collaborator.
  if (entityKind === "business") {
    if (isPro(inviterAvatarKind) && isPro(targetAvatarKind)) {
      // Pro inviting another pro into their business = employee.
      return { role: "employee", direction };
    }
    if (isFacility(inviterAvatarKind) && isFacility(targetAvatarKind)) {
      return { role: "employee", direction };
    }
    if (
      targetAvatarKind === "trade_pro_teammate" ||
      targetAvatarKind === "facilities_teammate" ||
      targetAvatarKind === "home_teammate"
    ) {
      return { role: "employee", direction };
    }
    if (isCollab(targetAvatarKind)) {
      return { role: "collaborator", direction };
    }
    if (isHome(targetAvatarKind)) {
      return { role: "collaborator", direction };
    }
    // Outside pro / facility joining someone else's business.
    return { role: "collaborator", direction };
  }

  // Fallback — shouldn't happen for a known entity kind, but the
  // resolver must always return rather than crash the request.
  return { role: "employee", direction };
}

/**
 * Whether a given avatar kind is allowed to control (be the founder /
 * homeowner / facility-manager of) an entity of the given kind. Used
 * by the entity-creation endpoint to gate POST /entities.
 */
export function canControlEntity(
  avatarKind: UserModeKind,
  entityKind: EntityKind,
): boolean {
  if (entityKind === "business") {
    return isPro(avatarKind) || isFacility(avatarKind);
  }
  if (entityKind === "residential_property") {
    return isHome(avatarKind);
  }
  if (entityKind === "commercial_property") {
    return isFacility(avatarKind) || isHome(avatarKind);
  }
  return false;
}
