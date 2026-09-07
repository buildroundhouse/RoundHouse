import { and, eq, isNull } from "drizzle-orm";
import {
  db,
  outwardAccountsTable,
  teamSeatsTable,
  type OutwardAccount,
  type TeamSeat,
  type TeamSeatPermissions,
} from "@workspace/db";

/**
 * Resolve an "active seat" for a (member, skin) pair if one exists.
 * The seat must be accepted, not removed, and the skin must still
 * exist and not be archived.
 *
 * Returns the seat row + the underlying outward account row when found,
 * otherwise null.
 */
export async function loadActiveSeat(
  memberClerkId: string,
  skinId: number,
): Promise<{ seat: TeamSeat; skin: OutwardAccount } | null> {
  const [row] = await db
    .select({
      seat: teamSeatsTable,
      skin: outwardAccountsTable,
    })
    .from(teamSeatsTable)
    .innerJoin(
      outwardAccountsTable,
      eq(outwardAccountsTable.id, teamSeatsTable.companyOutwardAccountId),
    )
    .where(
      and(
        eq(teamSeatsTable.companyOutwardAccountId, skinId),
        eq(teamSeatsTable.memberClerkId, memberClerkId),
        eq(teamSeatsTable.status, "accepted"),
        isNull(teamSeatsTable.removedAt),
        isNull(outwardAccountsTable.archivedAt),
      ),
    );
  return row ? { seat: row.seat, skin: row.skin } : null;
}

/**
 * List every accepted, non-removed seat held by a personal-profile user.
 * Used to populate their "switcher" with company skins they belong to
 * in addition to skins they own outright.
 */
export async function listAcceptedSeatsForMember(
  memberClerkId: string,
): Promise<Array<{ seat: TeamSeat; skin: OutwardAccount }>> {
  const rows = await db
    .select({
      seat: teamSeatsTable,
      skin: outwardAccountsTable,
    })
    .from(teamSeatsTable)
    .innerJoin(
      outwardAccountsTable,
      eq(outwardAccountsTable.id, teamSeatsTable.companyOutwardAccountId),
    )
    .where(
      and(
        eq(teamSeatsTable.memberClerkId, memberClerkId),
        eq(teamSeatsTable.status, "accepted"),
        isNull(teamSeatsTable.removedAt),
        isNull(outwardAccountsTable.archivedAt),
      ),
    );
  return rows.map((r) => ({ seat: r.seat, skin: r.skin }));
}

export const DEFAULT_SEAT_PERMISSIONS: Required<TeamSeatPermissions> = {
  seeContacts: false,
  seeBilling: false,
  createOnProperties: false,
  manageTeam: false,
};

export function normalizePermissions(
  raw: Partial<TeamSeatPermissions> | null | undefined,
): Required<TeamSeatPermissions> {
  const r = raw ?? {};
  return {
    seeContacts: Boolean(r.seeContacts),
    seeBilling: Boolean(r.seeBilling),
    createOnProperties: Boolean(r.createOnProperties),
    manageTeam: Boolean(r.manageTeam),
  };
}
