import { type Request, type Response, type NextFunction } from "express";
import { and, eq, isNull } from "drizzle-orm";
import { db, outwardAccountsTable, teamSeatsTable } from "@workspace/db";
import type { AuthRequest } from "./requireAuth";
import { resolveActiveOutwardAccountId } from "../lib/outwardAccounts";
import { normalizePermissions } from "../lib/teamSeats";

/**
 * Resolve the request's active outward account once, in this order:
 *   1. `x-active-outward-account-id` header, if it names an account
 *      either owned by the caller (and not archived) OR a company skin
 *      the caller holds an accepted, non-removed `team_seats` row on.
 *      In the latter case the request is "acting as a skin" and
 *      `actingAsTeamSeat` is populated with the seat permissions.
 *   2. `users.active_outward_account_id` (auto-healed to the user's first
 *      outward account if missing).
 *
 * Attaches `req.activeOutwardAccountId` (always defined; may be null when
 * the caller has no outward accounts yet) and `req.actingAsTeamSeat`
 * (null unless acting as a non-owned company skin).
 */
export const withActiveOutwardAccount = async (
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> => {
  const ar = req as AuthRequest;
  ar.activeOutwardAccountId = null;
  ar.actingAsTeamSeat = null;
  if (!ar.userId) {
    next();
    return;
  }

  const raw = req.header("x-active-outward-account-id");
  if (raw) {
    const id = Number(raw);
    if (Number.isFinite(id) && id > 0) {
      try {
        // First: skin owned by the caller (the common case).
        const [own] = await db
          .select({ id: outwardAccountsTable.id })
          .from(outwardAccountsTable)
          .where(
            and(
              eq(outwardAccountsTable.id, id),
              eq(outwardAccountsTable.ownerClerkId, ar.userId),
              isNull(outwardAccountsTable.archivedAt),
            ),
          )
          .limit(1);
        if (own) {
          ar.activeOutwardAccountId = own.id;
          next();
          return;
        }
        // Second: a team-seat skin (acting-as).
        const [seatRow] = await db
          .select({
            seatId: teamSeatsTable.id,
            permissions: teamSeatsTable.permissions,
            isAdmin: teamSeatsTable.isAdmin,
            skinId: outwardAccountsTable.id,
            skinOwnerClerkId: outwardAccountsTable.ownerClerkId,
          })
          .from(teamSeatsTable)
          .innerJoin(
            outwardAccountsTable,
            eq(outwardAccountsTable.id, teamSeatsTable.companyOutwardAccountId),
          )
          .where(
            and(
              eq(teamSeatsTable.companyOutwardAccountId, id),
              eq(teamSeatsTable.memberClerkId, ar.userId),
              eq(teamSeatsTable.status, "accepted"),
              isNull(teamSeatsTable.removedAt),
              isNull(outwardAccountsTable.archivedAt),
            ),
          )
          .limit(1);
        if (seatRow) {
          ar.activeOutwardAccountId = seatRow.skinId;
          ar.actingAsTeamSeat = {
            seatId: seatRow.seatId,
            skinId: seatRow.skinId,
            skinOwnerClerkId: seatRow.skinOwnerClerkId,
            isAdmin: seatRow.isAdmin,
            permissions: normalizePermissions(seatRow.permissions),
          };
          next();
          return;
        }
      } catch (err) {
        req.log?.warn(
          { err: err instanceof Error ? err.message : String(err) },
          "withActiveOutwardAccount header lookup failed",
        );
      }
    }
  }

  try {
    ar.activeOutwardAccountId = await resolveActiveOutwardAccountId(ar.userId);
  } catch (err) {
    req.log?.warn(
      { err: err instanceof Error ? err.message : String(err) },
      "withActiveOutwardAccount resolution failed",
    );
  }
  next();
};
