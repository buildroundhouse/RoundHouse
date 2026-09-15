/**
 * Entity membership auto-cast resolver.
 *
 * The client chooses the Entity and the relationship intent; the server
 * decides the technical membership role. Product-facing base Role and
 * authority remain separate concepts.
 *
 * Current product rules:
 * - Viewer is neutral and view-only, and may only participate through a
 *   residential or commercial Property / Facility.
 * - A Business can contain internal Trade Team Members and accepted outside
 *   Trade Professionals / subcontractors.
 * - Owner / Manager authority is not inferred merely from a base Role.
 * - Historical `*_collab` / `collab` avatar kinds are migration aliases only;
 *   new writes map those neutral identities to Viewer on Properties and never
 *   create the retired membership role.
 */
import type {
  UserModeKind,
  EntityKind,
  EntityMemberRole,
  EntityRelationshipKind,
  RoundhouseBaseRole,
} from "@workspace/db";

export type MembershipRelationshipIntent =
  | "internal_team"
  | "outside_trade"
  | "viewer"
  | "supplier";

export interface AutoCastInput {
  /** Acting identity doing the action. */
  inviterAvatarKind: UserModeKind;
  /** Acting identity being added. */
  targetAvatarKind: UserModeKind;
  /** Entity receiving the participant. */
  entityKind: EntityKind;
  /** Invite vs access request. */
  intent?: "invite" | "request";
  /** Explicit relationship selected in the Add / Invite flow. */
  relationship?: MembershipRelationshipIntent;
}

export interface AutoCastResult {
  role: EntityMemberRole;
  direction: "invite" | "request";
  baseRole: RoundhouseBaseRole;
  relationshipKind: EntityRelationshipKind | null;
}

const HOMEOWNER_KINDS = new Set<UserModeKind>(["home", "home_teammate"]);
const PRO_KINDS = new Set<UserModeKind>(["trade_pro", "trade_pro_teammate"]);
const FACILITY_KINDS = new Set<UserModeKind>([
  "facilities",
  "facilities_teammate",
]);

/**
 * Historical neutral/profile kinds. These strings remain in old rows and
 * generated clients during migration, but current UI calls them Viewer and
 * they may not be used to create a Business Team relationship.
 */
const LEGACY_VIEWER_KINDS = new Set<UserModeKind>([
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
function isLegacyViewer(k: UserModeKind): boolean {
  return LEGACY_VIEWER_KINDS.has(k);
}

function baseRoleForTarget(kind: UserModeKind): RoundhouseBaseRole {
  switch (kind) {
    case "home":
      return "homeowner";
    case "home_teammate":
      return "home_team_member";
    case "trade_pro":
      return "trade_professional";
    case "trade_pro_teammate":
      return "trade_team_member";
    case "facilities":
      return "commercial_management";
    case "facilities_teammate":
      return "commercial_team_member";
    case "trade_pro_collab":
    case "facilities_collab":
    case "collab":
      return "viewer";
  }
}

/**
 * Resolve the technical membership role plus product-facing metadata.
 * Throws for a relationship that is structurally invalid so the route can
 * return a useful 400 rather than manufacturing an inappropriate membership.
 */
export function autoCastMembership(input: AutoCastInput): AutoCastResult {
  const {
    inviterAvatarKind,
    targetAvatarKind,
    entityKind,
    intent,
    relationship,
  } = input;
  const direction: "invite" | "request" = intent ?? "invite";

  if (
    entityKind === "residential_property" ||
    entityKind === "commercial_property"
  ) {
    if (relationship === "viewer" || isLegacyViewer(targetAvatarKind)) {
      return {
        role: "viewer",
        direction,
        baseRole: "viewer",
        relationshipKind: "viewer",
      };
    }

    if (isHome(targetAvatarKind)) {
      return {
        // Technical authority storage retained for compatibility. Product UI
        // derives the base Role separately and does not call "admin" a Role.
        role: "admin",
        direction,
        baseRole:
          targetAvatarKind === "home" ? "homeowner" : "home_team_member",
        relationshipKind: null,
      };
    }

    if (isFacility(targetAvatarKind)) {
      return {
        role: targetAvatarKind === "facilities" ? "manager" : "employee",
        direction,
        baseRole:
          targetAvatarKind === "facilities"
            ? "commercial_management"
            : "commercial_team_member",
        relationshipKind: null,
      };
    }

    if (isPro(targetAvatarKind)) {
      return {
        role: "worker",
        direction,
        baseRole:
          targetAvatarKind === "trade_pro"
            ? "trade_professional"
            : "trade_team_member",
        relationshipKind:
          relationship === "internal_team" ? "internal_team" : "outside_trade",
      };
    }

    throw new Error("This identity cannot participate in this Property.");
  }

  if (entityKind === "business") {
    if (relationship === "viewer" || isLegacyViewer(targetAvatarKind)) {
      throw new Error(
        "Viewer access belongs to a Residential Property or Commercial Facility, not a Business Team.",
      );
    }

    if (relationship === "supplier") {
      return {
        role: "worker",
        direction,
        baseRole: "supplier",
        relationshipKind: "supplier",
      };
    }

    if (
      targetAvatarKind === "trade_pro_teammate" ||
      targetAvatarKind === "facilities_teammate" ||
      targetAvatarKind === "home_teammate"
    ) {
      return {
        role: "employee",
        direction,
        baseRole: baseRoleForTarget(targetAvatarKind),
        relationshipKind: "internal_team",
      };
    }

    if (isPro(targetAvatarKind)) {
      const outside = relationship !== "internal_team";
      return {
        role: outside ? "worker" : "employee",
        direction,
        baseRole: "trade_professional",
        relationshipKind: outside ? "outside_trade" : "internal_team",
      };
    }

    if (isFacility(targetAvatarKind)) {
      const outside = relationship !== "internal_team";
      return {
        role: outside ? "worker" : "employee",
        direction,
        baseRole:
          targetAvatarKind === "facilities"
            ? "commercial_management"
            : "commercial_team_member",
        relationshipKind: outside ? "outside_trade" : "internal_team",
      };
    }

    if (isHome(targetAvatarKind)) {
      throw new Error(
        "Home participants are not added to a Business Team. Add them through the appropriate Property relationship instead.",
      );
    }
  }

  throw new Error("Unsupported Entity participation relationship.");
}

/** Whether an acting identity may found/control the chosen Entity kind. */
export function canControlEntity(
  avatarKind: UserModeKind,
  entityKind: EntityKind,
): boolean {
  if (entityKind === "business") {
    return isPro(avatarKind) || isFacility(avatarKind);
  }
  if (entityKind === "residential_property") {
    return avatarKind === "home";
  }
  if (entityKind === "commercial_property") {
    return isFacility(avatarKind) || avatarKind === "home";
  }
  return false;
}
