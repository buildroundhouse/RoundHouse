import { db } from "@workspace/db";
import {
  propertiesTable,
  teamSeatsTable,
} from "@workspace/db/schema";
import { and, eq } from "drizzle-orm";
import {
  getMembershipForProperty,
  type PropertyMembershipShape,
} from "./migratePropertyEntities";

// Re-export the entity-members-backed helpers under propertyAccess so
// route files can import membership reads/writes from one place.
export {
  upsertPropertyMembership,
  archiveEntityMemberForProperty,
  archiveAllEntityMembersForProperty,
  listMembersForProperty,
  listMembershipsForUser,
  listMembershipsForUsersOnProperty,
  getMembershipForProperty,
  ensureEntityForProperty,
  purgeEntityForProperty,
  purgeEntitiesForProperties,
  type PropertyMembershipShape,
} from "./migratePropertyEntities";

/**
 * #503 — Per-property effective role.
 *
 * Resolves an `entity_members` row (in legacy property-membership
 * shape) into one of the canonical permission buckets the matrix
 * uses. Legacy memberships that pre-date the connection-driven
 * assignment flow (Task A/B) carry a null `classification`; we fall
 * back to the legacy `role` so the existing owner/admin paths keep
 * working.
 */
export type EffectiveRole =
  | "owner"
  | "admin"
  | "worker"
  | "outside_service_provider"
  | "collaborator"
  | "member"
  | "viewer";

export interface MembershipLike {
  role: string;
  classification?: string | null;
}

export function effectiveRole(m: MembershipLike | null | undefined): EffectiveRole | null {
  if (!m) return null;
  if (m.role === "owner") return "owner";
  if (m.role === "admin") return "admin";
  if (m.classification === "worker") return "worker";
  if (m.classification === "outside_service_provider") return "outside_service_provider";
  if (m.classification === "collaborator") return "collaborator";
  // Legacy / fallback
  if (m.role === "viewer") return "viewer";
  return "member";
}

/**
 * Who is allowed to assign new people to a property.
 * Per #503: Owner + Trade Pro Worker only — strictly. Legacy "admin"
 * role is NOT included; if a property still has an admin row, they
 * must be re-classified as a worker via the connection-driven flow
 * to gain assignment authority.
 */
export function canAssignPeople(m: MembershipLike | null | undefined): boolean {
  const r = effectiveRole(m);
  return r === "owner" || r === "worker";
}

/** Can this person create/edit work orders on the property at large?
 *  (Outside service providers create within their own scope — see
 *  canCreateOwnWorkOrder.)
 */
export function canManageProperty(m: MembershipLike | null | undefined): boolean {
  const r = effectiveRole(m);
  return r === "owner" || r === "admin" || r === "worker";
}

/** Outside service providers may create work orders, but only ones
 *  that are scoped to themselves (assigned to + created by them).
 */
export function canCreateOwnWorkOrder(m: MembershipLike | null | undefined): boolean {
  const r = effectiveRole(m);
  return r === "outside_service_provider";
}

/** Collaborators may post notes, but only `collaborator_private` ones. */
export function canPostCollaboratorNote(m: MembershipLike | null | undefined): boolean {
  const r = effectiveRole(m);
  return r === "collaborator";
}

/** Anyone with a membership at all can post visibility=all notes,
 *  except read-only collaborators (whose notes must be private).
 */
export function canPostPublicNote(m: MembershipLike | null | undefined): boolean {
  const r = effectiveRole(m);
  return r === "owner" || r === "admin" || r === "worker" || r === "outside_service_provider";
}

/**
 * Can the viewer read every collaborator-private note on this property
 * (i.e. should the read filter let *all* visibility rows through)?
 *
 * Per #503 this is restricted to: the property owner, the owner's
 * internal teammates (an accepted team_seats row pairing the viewer
 * with the owner's company outward account), and the note author
 * themselves. Workers and admins on the property do NOT get blanket
 * access — collaborator-private notes are confidential to the owner
 * household. Note authors always see their own private notes
 * regardless of this check (handled at the call site).
 */
export async function canReadCollaboratorNote(args: {
  propertyId: number;
  viewerClerkId: string;
  membership: MembershipLike | null | undefined;
}): Promise<boolean> {
  // Intentionally do NOT short-circuit on worker/admin — only owner +
  // owner-teammates may see another collaborator's private notes.
  const [owner] = await db
    .select({ ownerClerkId: propertiesTable.ownerClerkId, ownerOutwardAccountId: propertiesTable.ownerOutwardAccountId })
    .from(propertiesTable)
    .where(eq(propertiesTable.id, args.propertyId));
  if (!owner) return false;
  if (owner.ownerClerkId === args.viewerClerkId) return true;

  // Owner's internal teammate? Find an active team_seats row that
  // pairs the viewer (member_clerk_id) with the owner's company
  // outward account.
  if (!owner.ownerOutwardAccountId) return false;
  const [seat] = await db
    .select({ id: teamSeatsTable.id })
    .from(teamSeatsTable)
    .where(
      and(
        eq(teamSeatsTable.companyOutwardAccountId, owner.ownerOutwardAccountId),
        eq(teamSeatsTable.memberClerkId, args.viewerClerkId),
        eq(teamSeatsTable.status, "accepted"),
      ),
    );
  return Boolean(seat);
}

/**
 * Property membership read.
 *
 * Returns the property's membership for `userClerkId` from
 * `entity_members` (via the property → entity link). The shape is
 * preserved from the legacy property-members payload so the
 * `effectiveRole()` matrix and existing callers keep working
 * unchanged.
 */
export async function getMembership(
  propertyId: number,
  userClerkId: string,
): Promise<PropertyMembershipShape | null> {
  return getMembershipForProperty(propertyId, userClerkId);
}
