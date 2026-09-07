import { Router, type IRouter } from "express";
import { and, eq, isNull } from "drizzle-orm";
import {
  db,
  outwardAccountsTable,
  teamSeatsTable,
  usersTable,
  type TeamSeatPermissions,
  type TeamSeatRole,
} from "@workspace/db";
import { requireAuth, type AuthRequest } from "../middlewares/requireAuth";
import { normalizePermissions } from "../lib/teamSeats";
import { parseTeammateChipFields } from "../lib/connectionTags";
import { excludeDemoUsersWhere, isAdminDemoClerkId } from "../lib/adminDemo";

/** Look up the company skin's `kind` so we can validate the chip
 * against the appropriate curated list (Trade Pro vs Facility). */
async function loadCompanyKind(skinId: number): Promise<string | null> {
  const [row] = await db
    .select({ kind: outwardAccountsTable.kind })
    .from(outwardAccountsTable)
    .where(eq(outwardAccountsTable.id, skinId));
  return row?.kind ?? null;
}

const router: IRouter = Router();

const VALID_ROLES: TeamSeatRole[] = ["admin", "manager", "employee"];

/**
 * Look up a company outward account that the caller has admin authority
 * over: either they OWN the skin, or they hold an accepted seat with
 * `manageTeam` permission. Returns null if the skin doesn't exist or
 * the caller has no admin authority.
 */
async function loadAdministeredSkin(
  callerClerkId: string,
  skinId: number,
  ar: AuthRequest,
): Promise<{ ownerClerkId: string; isOwner: boolean } | null> {
  const [skin] = await db
    .select({ id: outwardAccountsTable.id, ownerClerkId: outwardAccountsTable.ownerClerkId })
    .from(outwardAccountsTable)
    .where(
      and(
        eq(outwardAccountsTable.id, skinId),
        isNull(outwardAccountsTable.archivedAt),
      ),
    );
  if (!skin) return null;
  if (skin.ownerClerkId === callerClerkId) {
    return { ownerClerkId: skin.ownerClerkId, isOwner: true };
  }
  // Acting-as caller: must hold a seat with manageTeam.
  if (
    ar.actingAsTeamSeat &&
    ar.actingAsTeamSeat.skinId === skinId &&
    (ar.actingAsTeamSeat.isAdmin || ar.actingAsTeamSeat.permissions.manageTeam)
  ) {
    return { ownerClerkId: skin.ownerClerkId, isOwner: false };
  }
  return null;
}

router.get(
  "/outward-accounts/:id/team",
  requireAuth,
  async (req, res): Promise<void> => {
    const ar = req as AuthRequest;
    const skinId = Number(req.params.id);
    if (!Number.isFinite(skinId) || skinId <= 0) {
      res.status(400).json({ error: "Invalid skin id" });
      return;
    }
    const admin = await loadAdministeredSkin(ar.userId, skinId, ar);
    if (!admin) {
      res.status(404).json({ error: "Skin not found or you lack access" });
      return;
    }
    const rows = await db
      .select({
        id: teamSeatsTable.id,
        memberClerkId: teamSeatsTable.memberClerkId,
        role: teamSeatsTable.role,
        isAdmin: teamSeatsTable.isAdmin,
        permissions: teamSeatsTable.permissions,
        status: teamSeatsTable.status,
        invitedAt: teamSeatsTable.invitedAt,
        acceptedAt: teamSeatsTable.acceptedAt,
        // #502 — universal chip rendered next to the teammate's name.
        chip: teamSeatsTable.chip,
        chipOther: teamSeatsTable.chipOther,
        name: usersTable.name,
        username: usersTable.username,
        avatarUrl: usersTable.avatarUrl,
      })
      .from(teamSeatsTable)
      .leftJoin(usersTable, eq(usersTable.clerkId, teamSeatsTable.memberClerkId))
      .where(
        and(
          eq(teamSeatsTable.companyOutwardAccountId, skinId),
          isNull(teamSeatsTable.removedAt),
        ),
      );
    res.json({ seats: rows.map((r) => ({ ...r, permissions: normalizePermissions(r.permissions) })) });
  },
);

router.post(
  "/outward-accounts/:id/team",
  requireAuth,
  async (req, res): Promise<void> => {
    const ar = req as AuthRequest;
    const skinId = Number(req.params.id);
    if (!Number.isFinite(skinId) || skinId <= 0) {
      res.status(400).json({ error: "Invalid skin id" });
      return;
    }
    const admin = await loadAdministeredSkin(ar.userId, skinId, ar);
    if (!admin) {
      res.status(403).json({ error: "Only the skin's admin can invite team members" });
      return;
    }
    const { clerkId, username, email, role, permissions, isAdmin } = req.body ?? {};
    const r = (typeof role === "string" ? role : "employee") as TeamSeatRole;
    if (!VALID_ROLES.includes(r)) {
      res.status(400).json({ error: "Invalid role" });
      return;
    }
    // #502 — admin may pre-set the teammate chip when inviting; the
    // teammate can change it later.
    const companyKind = await loadCompanyKind(skinId);
    const chipParse = parseTeammateChipFields(req.body ?? {}, companyKind);
    if (!chipParse.ok) {
      res.status(400).json({ error: chipParse.error });
      return;
    }

    let target:
      | { clerkId: string; name: string; username: string; avatarUrl: string }
      | undefined;
    if (typeof clerkId === "string" && clerkId.trim()) {
      const [u] = await db
        .select({
          clerkId: usersTable.clerkId,
          name: usersTable.name,
          username: usersTable.username,
          avatarUrl: usersTable.avatarUrl,
        })
        .from(usersTable)
        .where(eq(usersTable.clerkId, clerkId.trim()));
      target = u;
    } else if (typeof username === "string" && username.trim()) {
      const [u] = await db
        .select({
          clerkId: usersTable.clerkId,
          name: usersTable.name,
          username: usersTable.username,
          avatarUrl: usersTable.avatarUrl,
        })
        .from(usersTable)
        .where(eq(usersTable.username, username.trim().toLowerCase()));
      target = u;
    } else if (typeof email === "string" && email.trim()) {
      const [u] = await db
        .select({
          clerkId: usersTable.clerkId,
          name: usersTable.name,
          username: usersTable.username,
          avatarUrl: usersTable.avatarUrl,
        })
        .from(usersTable)
        .where(eq(usersTable.email, email.trim()));
      target = u;
    }
    if (!target) {
      res.status(404).json({ error: "We couldn't find a user with those details." });
      return;
    }
    // #676 — Refuse to seat an admin Wardrobe demo persona on a real
    // company skin. The same generic "not found" is returned so the
    // endpoint can't be used to probe whether a username belongs to a
    // demo persona — this matches the discovery-search rule that hides
    // demos from `@username` lookups.
    if (await isAdminDemoClerkId(target.clerkId)) {
      res.status(404).json({ error: "We couldn't find a user with those details." });
      return;
    }
    if (target.clerkId === admin.ownerClerkId) {
      res.status(400).json({ error: "The skin's owner already has full access." });
      return;
    }

    const perms = normalizePermissions(permissions as TeamSeatPermissions | undefined);
    const adminFlag = Boolean(isAdmin);
    if (adminFlag) {
      // Admin implies all permissions.
      perms.seeContacts = true;
      perms.seeBilling = true;
      perms.createOnProperties = true;
      perms.manageTeam = true;
    }

    // Upsert: existing row for this (skin, member) pair is reactivated/updated.
    const [existing] = await db
      .select()
      .from(teamSeatsTable)
      .where(
        and(
          eq(teamSeatsTable.companyOutwardAccountId, skinId),
          eq(teamSeatsTable.memberClerkId, target.clerkId),
        ),
      );
    let row;
    const chipUpdates: Record<string, unknown> = {};
    if (chipParse.chip !== undefined) chipUpdates.chip = chipParse.chip;
    if (chipParse.chipOther !== undefined) chipUpdates.chipOther = chipParse.chipOther;

    if (existing) {
      [row] = await db
        .update(teamSeatsTable)
        .set({
          role: r,
          isAdmin: adminFlag,
          permissions: perms,
          removedAt: null,
          // Keep status as-is if previously accepted; otherwise reset to pending.
          status: existing.status === "accepted" && existing.removedAt == null ? "accepted" : "pending",
          invitedAt: new Date(),
          ...chipUpdates,
        })
        .where(eq(teamSeatsTable.id, existing.id))
        .returning();
    } else {
      [row] = await db
        .insert(teamSeatsTable)
        .values({
          companyOutwardAccountId: skinId,
          memberClerkId: target.clerkId,
          role: r,
          isAdmin: adminFlag,
          permissions: perms,
          status: "pending",
          ...chipUpdates,
        })
        .returning();
    }

    res.json({
      id: row.id,
      memberClerkId: target.clerkId,
      name: target.name,
      username: target.username,
      avatarUrl: target.avatarUrl,
      role: row.role,
      isAdmin: row.isAdmin,
      permissions: normalizePermissions(row.permissions),
      status: row.status,
      invitedAt: row.invitedAt,
      acceptedAt: row.acceptedAt,
      chip: row.chip,
      chipOther: row.chipOther,
    });
  },
);

router.put(
  "/outward-accounts/:id/team/:memberClerkId",
  requireAuth,
  async (req, res): Promise<void> => {
    const ar = req as AuthRequest;
    const skinId = Number(req.params.id);
    const memberClerkId = String(req.params.memberClerkId);
    if (!Number.isFinite(skinId) || skinId <= 0) {
      res.status(400).json({ error: "Invalid skin id" });
      return;
    }
    const admin = await loadAdministeredSkin(ar.userId, skinId, ar);
    if (!admin) {
      res.status(403).json({ error: "Only the skin's admin can edit team members" });
      return;
    }

    const [existing] = await db
      .select()
      .from(teamSeatsTable)
      .where(
        and(
          eq(teamSeatsTable.companyOutwardAccountId, skinId),
          eq(teamSeatsTable.memberClerkId, memberClerkId),
          isNull(teamSeatsTable.removedAt),
        ),
      );
    if (!existing) {
      res.status(404).json({ error: "Seat not found" });
      return;
    }

    const updates: Record<string, unknown> = {};
    if (typeof req.body?.role === "string") {
      const r = req.body.role as TeamSeatRole;
      if (!VALID_ROLES.includes(r)) {
        res.status(400).json({ error: "Invalid role" });
        return;
      }
      updates.role = r;
    }
    if (typeof req.body?.isAdmin === "boolean") {
      updates.isAdmin = req.body.isAdmin;
    }
    if (req.body?.permissions && typeof req.body.permissions === "object") {
      const merged: TeamSeatPermissions = {
        ...normalizePermissions(existing.permissions),
        ...req.body.permissions,
      };
      updates.permissions = normalizePermissions(merged);
    }
    if (updates.isAdmin === true) {
      updates.permissions = {
        seeContacts: true,
        seeBilling: true,
        createOnProperties: true,
        manageTeam: true,
      };
    }

    // #502 — admin may also update the teammate chip in the same call.
    const companyKind = await loadCompanyKind(skinId);
    const chipParse = parseTeammateChipFields(req.body ?? {}, companyKind);
    if (!chipParse.ok) {
      res.status(400).json({ error: chipParse.error });
      return;
    }
    if (chipParse.chip !== undefined) updates.chip = chipParse.chip;
    if (chipParse.chipOther !== undefined) updates.chipOther = chipParse.chipOther;

    const [row] = await db
      .update(teamSeatsTable)
      .set(updates)
      .where(eq(teamSeatsTable.id, existing.id))
      .returning();
    res.json({
      id: row.id,
      memberClerkId: row.memberClerkId,
      role: row.role,
      isAdmin: row.isAdmin,
      permissions: normalizePermissions(row.permissions),
      status: row.status,
      chip: row.chip,
      chipOther: row.chipOther,
    });
  },
);

router.delete(
  "/outward-accounts/:id/team/:memberClerkId",
  requireAuth,
  async (req, res): Promise<void> => {
    const ar = req as AuthRequest;
    const skinId = Number(req.params.id);
    const memberClerkId = String(req.params.memberClerkId);
    if (!Number.isFinite(skinId) || skinId <= 0) {
      res.status(400).json({ error: "Invalid skin id" });
      return;
    }
    const admin = await loadAdministeredSkin(ar.userId, skinId, ar);
    if (!admin) {
      res.status(403).json({ error: "Only the skin's admin can remove team members" });
      return;
    }
    // Soft-delete: stamp removedAt. Records the team member created on
    // the skin remain attributed to the skin (they don't get deleted).
    await db
      .update(teamSeatsTable)
      .set({ removedAt: new Date(), status: "pending" })
      .where(
        and(
          eq(teamSeatsTable.companyOutwardAccountId, skinId),
          eq(teamSeatsTable.memberClerkId, memberClerkId),
        ),
      );
    res.json({ ok: true });
  },
);

router.get(
  "/users/me/team-seat-invites",
  requireAuth,
  async (req, res): Promise<void> => {
    const ar = req as AuthRequest;
    const rows = await db
      .select({
        id: teamSeatsTable.id,
        skinId: teamSeatsTable.companyOutwardAccountId,
        role: teamSeatsTable.role,
        isAdmin: teamSeatsTable.isAdmin,
        permissions: teamSeatsTable.permissions,
        invitedAt: teamSeatsTable.invitedAt,
        chip: teamSeatsTable.chip,
        chipOther: teamSeatsTable.chipOther,
        skinDisplayName: outwardAccountsTable.displayName,
        skinCompanyName: outwardAccountsTable.companyName,
        skinTitle: outwardAccountsTable.title,
        skinAvatarUrl: outwardAccountsTable.avatarUrl,
        skinKind: outwardAccountsTable.kind,
      })
      .from(teamSeatsTable)
      .innerJoin(
        outwardAccountsTable,
        eq(outwardAccountsTable.id, teamSeatsTable.companyOutwardAccountId),
      )
      .where(
        and(
          eq(teamSeatsTable.memberClerkId, ar.userId),
          eq(teamSeatsTable.status, "pending"),
          isNull(teamSeatsTable.removedAt),
          isNull(outwardAccountsTable.archivedAt),
          // #676 — defensive: a pending seat invite from a demo persona's
          // company skin must never surface in a real user's invite tray.
          // The POST gate already refuses to invite a demo as a member,
          // and the inverse direction (a demo sending invites) is
          // blocked here so historical/seeded rows can't leak the demo's
          // existence to a non-admin invitee.
          excludeDemoUsersWhere(outwardAccountsTable.ownerClerkId),
        ),
      );
    res.json({
      invites: rows.map((r) => ({
        ...r,
        permissions: normalizePermissions(r.permissions),
      })),
    });
  },
);

router.post(
  "/users/me/team-seat-invites/:seatId/accept",
  requireAuth,
  async (req, res): Promise<void> => {
    const ar = req as AuthRequest;
    const seatId = Number(req.params.seatId);
    if (!Number.isFinite(seatId) || seatId <= 0) {
      res.status(400).json({ error: "Invalid seat id" });
      return;
    }
    // #502 — teammate may pick their chip at acceptance time. Validate
    // against the company skin's curated list.
    const [seatPre] = await db
      .select({
        skinId: teamSeatsTable.companyOutwardAccountId,
      })
      .from(teamSeatsTable)
      .where(eq(teamSeatsTable.id, seatId));
    const companyKind = seatPre ? await loadCompanyKind(seatPre.skinId) : null;
    const chipParse = parseTeammateChipFields(req.body ?? {}, companyKind);
    if (!chipParse.ok) {
      res.status(400).json({ error: chipParse.error });
      return;
    }
    const setFields: Record<string, unknown> = {
      status: "accepted",
      acceptedAt: new Date(),
    };
    if (chipParse.chip !== undefined) setFields.chip = chipParse.chip;
    if (chipParse.chipOther !== undefined) setFields.chipOther = chipParse.chipOther;

    const [updated] = await db
      .update(teamSeatsTable)
      .set(setFields)
      .where(
        and(
          eq(teamSeatsTable.id, seatId),
          eq(teamSeatsTable.memberClerkId, ar.userId),
          eq(teamSeatsTable.status, "pending"),
          isNull(teamSeatsTable.removedAt),
        ),
      )
      .returning();
    if (!updated) {
      res.status(404).json({ error: "Invite not found" });
      return;
    }
    res.json({
      ok: true,
      seatId: updated.id,
      skinId: updated.companyOutwardAccountId,
      chip: updated.chip,
      chipOther: updated.chipOther,
    });
  },
);

/**
 * #502 — let a teammate update their own chip at any time after
 * acceptance. The chip is validated against the company skin's
 * curated list (Trade Pro vs Facility).
 */
router.patch(
  "/users/me/team-seats/:seatId/chip",
  requireAuth,
  async (req, res): Promise<void> => {
    const ar = req as AuthRequest;
    const seatId = Number(req.params.seatId);
    if (!Number.isFinite(seatId) || seatId <= 0) {
      res.status(400).json({ error: "Invalid seat id" });
      return;
    }
    const [seat] = await db
      .select()
      .from(teamSeatsTable)
      .where(
        and(
          eq(teamSeatsTable.id, seatId),
          eq(teamSeatsTable.memberClerkId, ar.userId),
          isNull(teamSeatsTable.removedAt),
        ),
      );
    if (!seat) {
      res.status(404).json({ error: "Seat not found" });
      return;
    }
    const companyKind = await loadCompanyKind(seat.companyOutwardAccountId);
    const chipParse = parseTeammateChipFields(req.body ?? {}, companyKind);
    if (!chipParse.ok) {
      res.status(400).json({ error: chipParse.error });
      return;
    }
    const setFields: Record<string, unknown> = {};
    if (chipParse.chip !== undefined) setFields.chip = chipParse.chip;
    if (chipParse.chipOther !== undefined) setFields.chipOther = chipParse.chipOther;
    if (Object.keys(setFields).length === 0) {
      res.json({ ok: true, chip: seat.chip, chipOther: seat.chipOther });
      return;
    }
    const [row] = await db
      .update(teamSeatsTable)
      .set(setFields)
      .where(eq(teamSeatsTable.id, seatId))
      .returning();
    res.json({ ok: true, chip: row.chip, chipOther: row.chipOther });
  },
);

router.post(
  "/users/me/team-seat-invites/:seatId/decline",
  requireAuth,
  async (req, res): Promise<void> => {
    const ar = req as AuthRequest;
    const seatId = Number(req.params.seatId);
    if (!Number.isFinite(seatId) || seatId <= 0) {
      res.status(400).json({ error: "Invalid seat id" });
      return;
    }
    await db
      .delete(teamSeatsTable)
      .where(
        and(
          eq(teamSeatsTable.id, seatId),
          eq(teamSeatsTable.memberClerkId, ar.userId),
          eq(teamSeatsTable.status, "pending"),
        ),
      );
    res.json({ ok: true });
  },
);

export default router;
