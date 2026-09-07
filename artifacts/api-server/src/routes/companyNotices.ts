import { Router, type IRouter } from "express";
import { and, desc, eq, gt, inArray, isNull } from "drizzle-orm";
import {
  db,
  companyNoticesTable,
  companyNoticeAcksTable,
  notificationsTable,
  outwardAccountsTable,
  teamSeatsTable,
  usersTable,
} from "@workspace/db";
import { requireAuth, type AuthRequest } from "../middlewares/requireAuth";
import { sendPushToUsers } from "../lib/push";
import { insertNotifications } from "../lib/insertNotifications";
import { logger } from "../lib/logger";

/**
 * How long an admin must wait between consecutive nudges aimed at the
 * same teammate for the same notice. Keeps the "Send reminder" affordance
 * from turning into a spam button.
 */
const NUDGE_RATE_LIMIT_MS = 24 * 60 * 60 * 1000;
const COMPANY_NOTICE_NUDGE_TYPE = "company_notice_nudge";

const router: IRouter = Router();

const NOTICE_PUSH_BODY_MAX = 140;

function buildNoticeSnippet(body: string): string {
  const collapsed = body.replace(/\s+/g, " ").trim();
  if (collapsed.length <= NOTICE_PUSH_BODY_MAX) return collapsed;
  return `${collapsed.slice(0, NOTICE_PUSH_BODY_MAX - 1).trimEnd()}…`;
}

/**
 * Every clerkId that should hear about a notice posted on `companyId`:
 * the skin owner plus every accepted, non-removed team-seat member.
 * The sender is excluded so they don't get pinged about their own post.
 */
async function loadNoticeRecipientClerkIds(
  companyId: number,
  senderClerkId: string,
): Promise<string[]> {
  const [own] = await db
    .select({ ownerClerkId: outwardAccountsTable.ownerClerkId })
    .from(outwardAccountsTable)
    .where(eq(outwardAccountsTable.id, companyId));
  const seats = await db
    .select({ memberClerkId: teamSeatsTable.memberClerkId })
    .from(teamSeatsTable)
    .where(
      and(
        eq(teamSeatsTable.companyOutwardAccountId, companyId),
        eq(teamSeatsTable.status, "accepted"),
        isNull(teamSeatsTable.removedAt),
      ),
    );
  const ids = new Set<string>();
  if (own?.ownerClerkId) ids.add(own.ownerClerkId);
  for (const s of seats) {
    if (s.memberClerkId) ids.add(s.memberClerkId);
  }
  ids.delete(senderClerkId);
  return [...ids];
}

function parseId(raw: unknown): number {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return parseInt(String(v), 10);
}

type NoticeRow = typeof companyNoticesTable.$inferSelect;

type AckSummary = {
  memberClerkId: string;
  name: string | null;
  username: string | null;
  avatarUrl: string | null;
  acknowledgedAt: string;
};

type PendingMember = {
  memberClerkId: string;
  name: string | null;
  username: string | null;
  avatarUrl: string | null;
  lastNudgedAt: string | null;
};

function serialize(
  n: NoticeRow,
  extras: {
    companyName: string | null;
    senderName: string | null;
    senderUsername: string | null;
    senderAvatarUrl: string | null;
    acknowledgedAt: string | null;
    canDelete: boolean;
    isSender: boolean;
    ackCount: number;
    recipientCount: number;
    acks: AckSummary[] | null;
    pendingMembers: PendingMember[] | null;
  },
) {
  return {
    id: n.id,
    companyOutwardAccountId: n.companyOutwardAccountId,
    senderClerkId: n.senderClerkId,
    title: n.title,
    body: n.body,
    createdAt: n.createdAt.toISOString(),
    companyName: extras.companyName,
    senderName: extras.senderName,
    senderUsername: extras.senderUsername,
    senderAvatarUrl: extras.senderAvatarUrl,
    acknowledgedAt: extras.acknowledgedAt,
    canDelete: extras.canDelete,
    isSender: extras.isSender,
    ackCount: extras.ackCount,
    recipientCount: extras.recipientCount,
    acks: extras.acks,
    pendingMembers: extras.pendingMembers,
  };
}

/**
 * Set of company outward account ids the user may administer (post or
 * delete notices on). Owners + accepted seats with isAdmin/manageTeam.
 */
async function loadAdministeredCompanyIds(
  userId: string,
): Promise<Set<number>> {
  const owned = await db
    .select({ id: outwardAccountsTable.id })
    .from(outwardAccountsTable)
    .where(
      and(
        eq(outwardAccountsTable.ownerClerkId, userId),
        isNull(outwardAccountsTable.archivedAt),
      ),
    );
  const seated = await db
    .select({
      id: teamSeatsTable.companyOutwardAccountId,
      isAdmin: teamSeatsTable.isAdmin,
      permissions: teamSeatsTable.permissions,
    })
    .from(teamSeatsTable)
    .innerJoin(
      outwardAccountsTable,
      eq(outwardAccountsTable.id, teamSeatsTable.companyOutwardAccountId),
    )
    .where(
      and(
        eq(teamSeatsTable.memberClerkId, userId),
        eq(teamSeatsTable.status, "accepted"),
        isNull(teamSeatsTable.removedAt),
        isNull(outwardAccountsTable.archivedAt),
      ),
    );
  const ids = new Set<number>();
  for (const r of owned) ids.add(r.id);
  for (const r of seated) {
    if (r.isAdmin === true || r.permissions?.manageTeam === true) {
      ids.add(r.id);
    }
  }
  return ids;
}

/**
 * Find every company outward account the signed-in user can receive
 * notices from: skins they own AND skins where they hold an accepted,
 * non-removed team seat.
 */
async function loadVisibleCompanyIds(userId: string): Promise<number[]> {
  const owned = await db
    .select({ id: outwardAccountsTable.id })
    .from(outwardAccountsTable)
    .where(
      and(
        eq(outwardAccountsTable.ownerClerkId, userId),
        isNull(outwardAccountsTable.archivedAt),
      ),
    );
  const seated = await db
    .select({ id: teamSeatsTable.companyOutwardAccountId })
    .from(teamSeatsTable)
    .innerJoin(
      outwardAccountsTable,
      eq(outwardAccountsTable.id, teamSeatsTable.companyOutwardAccountId),
    )
    .where(
      and(
        eq(teamSeatsTable.memberClerkId, userId),
        eq(teamSeatsTable.status, "accepted"),
        isNull(teamSeatsTable.removedAt),
        isNull(outwardAccountsTable.archivedAt),
      ),
    );
  const ids = new Set<number>();
  for (const r of owned) ids.add(r.id);
  for (const r of seated) ids.add(r.id);
  return [...ids];
}

/**
 * Authorization for posting/deleting a notice on a given company skin.
 * Requires either ownership of the skin OR an accepted seat with
 * `isAdmin` or `manageTeam`.
 */
async function canAdministerCompany(
  userId: string,
  companyId: number,
): Promise<boolean> {
  const [own] = await db
    .select({ id: outwardAccountsTable.id })
    .from(outwardAccountsTable)
    .where(
      and(
        eq(outwardAccountsTable.id, companyId),
        eq(outwardAccountsTable.ownerClerkId, userId),
        isNull(outwardAccountsTable.archivedAt),
      ),
    );
  if (own) return true;
  const [seat] = await db
    .select({
      isAdmin: teamSeatsTable.isAdmin,
      permissions: teamSeatsTable.permissions,
    })
    .from(teamSeatsTable)
    .where(
      and(
        eq(teamSeatsTable.companyOutwardAccountId, companyId),
        eq(teamSeatsTable.memberClerkId, userId),
        eq(teamSeatsTable.status, "accepted"),
        isNull(teamSeatsTable.removedAt),
      ),
    );
  if (!seat) return false;
  return seat.isAdmin === true || seat.permissions?.manageTeam === true;
}

/**
 * GET /company-notices — list notices for every company the signed-in
 * user belongs to, joined with sender + company labels and the user's
 * own acknowledgement status. Acknowledged notices are still returned
 * so the client can decide whether to surface them; the default
 * Reminders surface filters them out by `acknowledgedAt`.
 */
router.get("/company-notices", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthRequest;
  const companyIds = await loadVisibleCompanyIds(userId);
  if (companyIds.length === 0) {
    res.json({ notices: [] });
    return;
  }
  const adminIds = await loadAdministeredCompanyIds(userId);
  const rows = await db
    .select()
    .from(companyNoticesTable)
    .where(inArray(companyNoticesTable.companyOutwardAccountId, companyIds))
    .orderBy(desc(companyNoticesTable.createdAt));
  if (rows.length === 0) {
    res.json({ notices: [] });
    return;
  }
  const senderIds = [...new Set(rows.map((r) => r.senderClerkId))];
  const senders = await db
    .select({
      clerkId: usersTable.clerkId,
      name: usersTable.name,
      username: usersTable.username,
      avatarUrl: usersTable.avatarUrl,
    })
    .from(usersTable)
    .where(inArray(usersTable.clerkId, senderIds));
  const senderMap = new Map(senders.map((s) => [s.clerkId, s]));
  const companies = await db
    .select({
      id: outwardAccountsTable.id,
      companyName: outwardAccountsTable.companyName,
      title: outwardAccountsTable.title,
      displayName: outwardAccountsTable.displayName,
    })
    .from(outwardAccountsTable)
    .where(inArray(outwardAccountsTable.id, companyIds));
  const companyMap = new Map(
    companies.map((c) => [
      c.id,
      c.companyName?.trim() ||
        c.title?.trim() ||
        c.displayName?.trim() ||
        null,
    ]),
  );
  const noticeIds = rows.map((r) => r.id);
  const myAcks = await db
    .select({
      noticeId: companyNoticeAcksTable.noticeId,
      acknowledgedAt: companyNoticeAcksTable.acknowledgedAt,
    })
    .from(companyNoticeAcksTable)
    .where(
      and(
        eq(companyNoticeAcksTable.memberClerkId, userId),
        inArray(companyNoticeAcksTable.noticeId, noticeIds),
      ),
    );
  const myAckMap = new Map(
    myAcks.map((a) => [a.noticeId, a.acknowledgedAt.toISOString()]),
  );

  // All acks across these notices, joined with the acknowledger's user
  // profile so admins can see who's read each notice.
  const allAcks = await db
    .select({
      noticeId: companyNoticeAcksTable.noticeId,
      memberClerkId: companyNoticeAcksTable.memberClerkId,
      acknowledgedAt: companyNoticeAcksTable.acknowledgedAt,
      name: usersTable.name,
      username: usersTable.username,
      avatarUrl: usersTable.avatarUrl,
    })
    .from(companyNoticeAcksTable)
    .leftJoin(
      usersTable,
      eq(usersTable.clerkId, companyNoticeAcksTable.memberClerkId),
    )
    .where(inArray(companyNoticeAcksTable.noticeId, noticeIds));
  const acksByNotice = new Map<number, AckSummary[]>();
  for (const a of allAcks) {
    const list = acksByNotice.get(a.noticeId) ?? [];
    list.push({
      memberClerkId: a.memberClerkId,
      name: a.name ?? null,
      username: a.username ?? null,
      avatarUrl: a.avatarUrl ?? null,
      acknowledgedAt: a.acknowledgedAt.toISOString(),
    });
    acksByNotice.set(a.noticeId, list);
  }
  for (const list of acksByNotice.values()) {
    list.sort((a, b) => a.acknowledgedAt.localeCompare(b.acknowledgedAt));
  }

  // Recipient count per company = owner + accepted, non-removed seats.
  // Use a Set of clerk ids per company to dedupe in case the owner also
  // appears as a seat.
  const owners = await db
    .select({
      id: outwardAccountsTable.id,
      ownerClerkId: outwardAccountsTable.ownerClerkId,
    })
    .from(outwardAccountsTable)
    .where(inArray(outwardAccountsTable.id, companyIds));
  const seatRows = await db
    .select({
      companyId: teamSeatsTable.companyOutwardAccountId,
      memberClerkId: teamSeatsTable.memberClerkId,
    })
    .from(teamSeatsTable)
    .where(
      and(
        inArray(teamSeatsTable.companyOutwardAccountId, companyIds),
        eq(teamSeatsTable.status, "accepted"),
        isNull(teamSeatsTable.removedAt),
      ),
    );
  const memberSets = new Map<number, Set<string>>();
  for (const o of owners) {
    memberSets.set(o.id, new Set([o.ownerClerkId]));
  }
  for (const s of seatRows) {
    const set = memberSets.get(s.companyId);
    if (set) set.add(s.memberClerkId);
  }

  // Look up profile info for every member that might appear as a
  // pending (not-yet-read) acknowledger on a notice the caller can
  // see. We only need this for admin-visible notices, but loading
  // them all in one query is simpler and avoids a per-notice fetch.
  const allMemberIds = new Set<string>();
  for (const set of memberSets.values()) {
    for (const id of set) allMemberIds.add(id);
  }
  const memberProfiles = allMemberIds.size
    ? await db
        .select({
          clerkId: usersTable.clerkId,
          name: usersTable.name,
          username: usersTable.username,
          avatarUrl: usersTable.avatarUrl,
        })
        .from(usersTable)
        .where(inArray(usersTable.clerkId, [...allMemberIds]))
    : [];
  const memberProfileMap = new Map(
    memberProfiles.map((m) => [m.clerkId, m]),
  );

  // Latest nudge timestamp per (notice, member). The nudge endpoint
  // records each reminder as a `company_notice_nudge` notification row
  // whose `relatedId` is the notice id; pulling them here lets admins
  // see "Reminded <relative time>" on pending rows even after the
  // sheet has been closed and reopened. Loaded for every notice id in
  // one query and bucketed in JS rather than per-notice fetches.
  const noticeIdStrings = noticeIds.map((id) => String(id));
  const nudgeRows = noticeIdStrings.length
    ? await db
        .select({
          relatedId: notificationsTable.relatedId,
          memberClerkId: notificationsTable.userClerkId,
          createdAt: notificationsTable.createdAt,
        })
        .from(notificationsTable)
        .where(
          and(
            eq(notificationsTable.type, COMPANY_NOTICE_NUDGE_TYPE),
            inArray(notificationsTable.relatedId, noticeIdStrings),
          ),
        )
    : [];
  // key = `${noticeId}:${memberClerkId}` -> latest createdAt iso
  const lastNudgeMap = new Map<string, string>();
  for (const r of nudgeRows) {
    if (!r.relatedId) continue;
    const key = `${r.relatedId}:${r.memberClerkId}`;
    const iso = r.createdAt.toISOString();
    const existing = lastNudgeMap.get(key);
    if (!existing || existing < iso) lastNudgeMap.set(key, iso);
  }

  res.json({
    notices: rows.map((r) => {
      const sender = senderMap.get(r.senderClerkId);
      const isAdmin = adminIds.has(r.companyOutwardAccountId);
      const isSender = r.senderClerkId === userId;
      const noticeAcks = acksByNotice.get(r.id) ?? [];
      const memberSet = memberSets.get(r.companyOutwardAccountId);
      const recipientCount = memberSet?.size ?? 0;
      let pendingMembers: PendingMember[] | null = null;
      // Pending-readers list is admin-only — non-admin senders do not
      // get to see who hasn't read their notice. The sender is never
      // listed as pending for their own notice (posting implies they
      // already know), matching the create-notice response.
      if (isAdmin && memberSet) {
        const ackedIds = new Set(noticeAcks.map((a) => a.memberClerkId));
        const pending: PendingMember[] = [];
        for (const memberId of memberSet) {
          if (ackedIds.has(memberId)) continue;
          if (memberId === r.senderClerkId) continue;
          const profile = memberProfileMap.get(memberId);
          pending.push({
            memberClerkId: memberId,
            name: profile?.name ?? null,
            username: profile?.username ?? null,
            avatarUrl: profile?.avatarUrl ?? null,
            lastNudgedAt: lastNudgeMap.get(`${r.id}:${memberId}`) ?? null,
          });
        }
        pending.sort((a, b) => {
          const an = (a.name || a.username || a.memberClerkId).toLowerCase();
          const bn = (b.name || b.username || b.memberClerkId).toLowerCase();
          return an.localeCompare(bn);
        });
        pendingMembers = pending;
      }
      return serialize(r, {
        companyName: companyMap.get(r.companyOutwardAccountId) ?? null,
        senderName: sender?.name ?? null,
        senderUsername: sender?.username ?? null,
        senderAvatarUrl: sender?.avatarUrl ?? null,
        acknowledgedAt: myAckMap.get(r.id) ?? null,
        canDelete: isSender || isAdmin,
        isSender,
        ackCount: noticeAcks.length,
        recipientCount,
        // Sender always sees read receipts on their own notice, even if
        // they later lose admin permissions on the company.
        acks: isAdmin || isSender ? noticeAcks : null,
        pendingMembers,
      });
    }),
  });
});

/**
 * GET /company-notices/postable-companies — every company outward
 * account where the signed-in user is allowed to post a notice
 * (owner, or an accepted seat with isAdmin / manageTeam). Used by the
 * mobile composer to decide whether to show the "Post a notice" button
 * and to populate the team picker.
 */
router.get(
  "/company-notices/postable-companies",
  requireAuth,
  async (req, res): Promise<void> => {
    const { userId } = req as AuthRequest;
    const owned = await db
      .select({
        id: outwardAccountsTable.id,
        companyName: outwardAccountsTable.companyName,
        title: outwardAccountsTable.title,
        displayName: outwardAccountsTable.displayName,
        kind: outwardAccountsTable.kind,
      })
      .from(outwardAccountsTable)
      .where(
        and(
          eq(outwardAccountsTable.ownerClerkId, userId),
          isNull(outwardAccountsTable.archivedAt),
        ),
      );
    const seated = await db
      .select({
        id: outwardAccountsTable.id,
        companyName: outwardAccountsTable.companyName,
        title: outwardAccountsTable.title,
        displayName: outwardAccountsTable.displayName,
        kind: outwardAccountsTable.kind,
        isAdmin: teamSeatsTable.isAdmin,
        permissions: teamSeatsTable.permissions,
      })
      .from(teamSeatsTable)
      .innerJoin(
        outwardAccountsTable,
        eq(outwardAccountsTable.id, teamSeatsTable.companyOutwardAccountId),
      )
      .where(
        and(
          eq(teamSeatsTable.memberClerkId, userId),
          eq(teamSeatsTable.status, "accepted"),
          isNull(teamSeatsTable.removedAt),
          isNull(outwardAccountsTable.archivedAt),
        ),
      );
    const map = new Map<
      number,
      { id: number; name: string; kind: string }
    >();
    const labelOf = (c: {
      companyName: string | null;
      title: string | null;
      displayName: string | null;
      id: number;
    }) =>
      c.companyName?.trim() ||
      c.title?.trim() ||
      c.displayName?.trim() ||
      `Company #${c.id}`;
    // Owners can always post on their own company skins.
    for (const c of owned) {
      if (c.kind === "trade_pro") {
        map.set(c.id, { id: c.id, name: labelOf(c), kind: c.kind });
      }
    }
    // Team-seat admins can post even though they don't own the skin.
    // Restrict to trade_pro skins to match owner-side filtering — a
    // team seat on a non-company skin shouldn't expose a posting target.
    for (const c of seated) {
      if (c.kind !== "trade_pro") continue;
      const isAdmin =
        c.isAdmin === true || c.permissions?.manageTeam === true;
      if (!isAdmin) continue;
      if (!map.has(c.id)) {
        map.set(c.id, { id: c.id, name: labelOf(c), kind: c.kind });
      }
    }
    res.json({
      companies: [...map.values()].sort((a, b) =>
        a.name.localeCompare(b.name),
      ),
    });
  },
);

/**
 * POST /outward-accounts/:companyId/company-notices — admins post a
 * new notice. Requires ownership of the skin or an accepted team-seat
 * with `isAdmin` / `manageTeam`.
 */
router.post(
  "/outward-accounts/:companyId/company-notices",
  requireAuth,
  async (req, res): Promise<void> => {
    const { userId } = req as AuthRequest;
    const companyId = parseId(req.params.companyId);
    if (!Number.isFinite(companyId) || companyId <= 0) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    if (!(await canAdministerCompany(userId, companyId))) {
      res
        .status(403)
        .json({ error: "Only the company's admins can post notices" });
      return;
    }
    const { title, body } = req.body ?? {};
    const titleStr = typeof title === "string" ? title.trim() : "";
    const bodyStr = typeof body === "string" ? body.trim() : "";
    if (!titleStr) {
      res.status(400).json({ error: "title is required" });
      return;
    }
    if (!bodyStr) {
      res.status(400).json({ error: "body is required" });
      return;
    }
    const [row] = await db
      .insert(companyNoticesTable)
      .values({
        companyOutwardAccountId: companyId,
        senderClerkId: userId,
        title: titleStr,
        body: bodyStr,
      })
      .returning();
    const [sender] = await db
      .select({
        name: usersTable.name,
        username: usersTable.username,
        avatarUrl: usersTable.avatarUrl,
      })
      .from(usersTable)
      .where(eq(usersTable.clerkId, userId));
    const [company] = await db
      .select({
        companyName: outwardAccountsTable.companyName,
        title: outwardAccountsTable.title,
        displayName: outwardAccountsTable.displayName,
      })
      .from(outwardAccountsTable)
      .where(eq(outwardAccountsTable.id, companyId));
    const companyName =
      company?.companyName?.trim() ||
      company?.title?.trim() ||
      company?.displayName?.trim() ||
      null;
    // Recipient count for the new notice's company.
    const [ownerRow] = await db
      .select({ ownerClerkId: outwardAccountsTable.ownerClerkId })
      .from(outwardAccountsTable)
      .where(eq(outwardAccountsTable.id, companyId));
    const seats = await db
      .select({ memberClerkId: teamSeatsTable.memberClerkId })
      .from(teamSeatsTable)
      .where(
        and(
          eq(teamSeatsTable.companyOutwardAccountId, companyId),
          eq(teamSeatsTable.status, "accepted"),
          isNull(teamSeatsTable.removedAt),
        ),
      );
    const members = new Set<string>();
    if (ownerRow?.ownerClerkId) members.add(ownerRow.ownerClerkId);
    for (const s of seats) members.add(s.memberClerkId);

    // Pending members at creation time = everyone in the company except
    // the sender (the sender's POST implicitly counts as "they know").
    const pendingIds = [...members].filter((id) => id !== userId);
    const pendingProfiles = pendingIds.length
      ? await db
          .select({
            clerkId: usersTable.clerkId,
            name: usersTable.name,
            username: usersTable.username,
            avatarUrl: usersTable.avatarUrl,
          })
          .from(usersTable)
          .where(inArray(usersTable.clerkId, pendingIds))
      : [];
    const pendingProfileMap = new Map(
      pendingProfiles.map((p) => [p.clerkId, p]),
    );
    const pendingMembers: PendingMember[] = pendingIds
      .map((id) => {
        const p = pendingProfileMap.get(id);
        return {
          memberClerkId: id,
          name: p?.name ?? null,
          username: p?.username ?? null,
          avatarUrl: p?.avatarUrl ?? null,
          // Brand-new notice: no nudges have been sent yet by definition.
          lastNudgedAt: null,
        };
      })
      .sort((a, b) => {
        const an = (a.name || a.username || a.memberClerkId).toLowerCase();
        const bn = (b.name || b.username || b.memberClerkId).toLowerCase();
        return an.localeCompare(bn);
      });

    // Fan out a push to every other team member of this company so
    // timely announcements (closures, schedule changes, safety alerts)
    // reach the team right away instead of waiting for the next
    // Reminders-hub open. The recipient lookup is the only thing that
    // can throw here — `sendPushToUsers` already swallows its own
    // errors — so wrap that lookup explicitly and keep the push call
    // fire-and-forget so it can't delay the response.
    let recipients: string[] = [];
    try {
      recipients = await loadNoticeRecipientClerkIds(companyId, userId);
    } catch (err) {
      logger.warn(
        { err, noticeId: row.id, companyId },
        "Failed to load company-notice push recipients",
      );
    }
    if (recipients.length > 0) {
      const pushTitle = companyName
        ? `${companyName}: ${row.title}`
        : row.title;
      void sendPushToUsers(recipients, {
        title: pushTitle,
        body: buildNoticeSnippet(row.body),
        data: {
          type: "company_notice",
          noticeId: row.id,
          companyOutwardAccountId: companyId,
        },
      });
    }

    res.status(201).json(
      serialize(row, {
        companyName,
        senderName: sender?.name ?? null,
        senderUsername: sender?.username ?? null,
        senderAvatarUrl: sender?.avatarUrl ?? null,
        acknowledgedAt: null,
        canDelete: true,
        isSender: true,
        ackCount: 0,
        recipientCount: members.size,
        acks: [],
        pendingMembers,
      }),
    );
  },
);

/**
 * POST /company-notices/:id/acknowledge — recipient marks the notice
 * as acknowledged/dismissed. Idempotent: re-acking is a no-op (returns
 * the existing ack timestamp).
 */
router.post(
  "/company-notices/:noticeId/acknowledge",
  requireAuth,
  async (req, res): Promise<void> => {
    const { userId } = req as AuthRequest;
    const noticeId = parseId(req.params.noticeId);
    if (!Number.isFinite(noticeId) || noticeId <= 0) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const [notice] = await db
      .select({
        id: companyNoticesTable.id,
        companyOutwardAccountId: companyNoticesTable.companyOutwardAccountId,
      })
      .from(companyNoticesTable)
      .where(eq(companyNoticesTable.id, noticeId));
    if (!notice) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const visible = await loadVisibleCompanyIds(userId);
    if (!visible.includes(notice.companyOutwardAccountId)) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const acknowledgedAt = new Date();
    await db
      .insert(companyNoticeAcksTable)
      .values({
        noticeId,
        memberClerkId: userId,
        acknowledgedAt,
      })
      .onConflictDoNothing({
        target: [
          companyNoticeAcksTable.noticeId,
          companyNoticeAcksTable.memberClerkId,
        ],
      });
    const [ack] = await db
      .select({ acknowledgedAt: companyNoticeAcksTable.acknowledgedAt })
      .from(companyNoticeAcksTable)
      .where(
        and(
          eq(companyNoticeAcksTable.noticeId, noticeId),
          eq(companyNoticeAcksTable.memberClerkId, userId),
        ),
      );
    res.json({
      noticeId,
      acknowledgedAt: ack?.acknowledgedAt.toISOString() ?? acknowledgedAt.toISOString(),
    });
  },
);

/**
 * POST /company-notices/:noticeId/nudge — admin pings a teammate who
 * hasn't acknowledged the notice yet, asking them to read it.
 *
 * Authorization mirrors the create endpoint: only owners and team-seat
 * admins (isAdmin / manageTeam) of the notice's company may nudge.
 *
 * The recipient must be:
 *   - an accepted, non-removed member of the same company,
 *   - someone other than the sender (the sender already "knows" by
 *     authoring), and
 *   - someone who has not yet posted an ack row for this notice.
 *
 * Rate limiting: a member may be nudged for the same notice at most
 * once per `NUDGE_RATE_LIMIT_MS` (24h). The check looks at the most
 * recent `company_notice_nudge` notification for this (member, notice)
 * pair so we don't need a separate ledger table.
 */
router.post(
  "/company-notices/:noticeId/nudge",
  requireAuth,
  async (req, res): Promise<void> => {
    const { userId } = req as AuthRequest;
    const noticeId = parseId(req.params.noticeId);
    if (!Number.isFinite(noticeId) || noticeId <= 0) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const memberClerkIdRaw =
      typeof req.body?.memberClerkId === "string"
        ? req.body.memberClerkId.trim()
        : "";
    if (!memberClerkIdRaw) {
      res.status(400).json({ error: "memberClerkId is required" });
      return;
    }

    const [notice] = await db
      .select()
      .from(companyNoticesTable)
      .where(eq(companyNoticesTable.id, noticeId));
    if (!notice) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    if (!(await canAdministerCompany(userId, notice.companyOutwardAccountId))) {
      res
        .status(403)
        .json({ error: "Only the company's admins can send reminders" });
      return;
    }
    if (memberClerkIdRaw === notice.senderClerkId) {
      res
        .status(400)
        .json({ error: "The sender doesn't need a reminder for their own notice" });
      return;
    }

    // Recipient must be a current teammate of the notice's company.
    const isOwner = await db
      .select({ id: outwardAccountsTable.id })
      .from(outwardAccountsTable)
      .where(
        and(
          eq(outwardAccountsTable.id, notice.companyOutwardAccountId),
          eq(outwardAccountsTable.ownerClerkId, memberClerkIdRaw),
          isNull(outwardAccountsTable.archivedAt),
        ),
      );
    let recipientIsMember = isOwner.length > 0;
    if (!recipientIsMember) {
      const [seat] = await db
        .select({ id: teamSeatsTable.id })
        .from(teamSeatsTable)
        .where(
          and(
            eq(teamSeatsTable.companyOutwardAccountId, notice.companyOutwardAccountId),
            eq(teamSeatsTable.memberClerkId, memberClerkIdRaw),
            eq(teamSeatsTable.status, "accepted"),
            isNull(teamSeatsTable.removedAt),
          ),
        );
      recipientIsMember = !!seat;
    }
    if (!recipientIsMember) {
      res.status(404).json({ error: "Member not found on this team" });
      return;
    }

    // Already-acknowledged members shouldn't get a nudge.
    const [existingAck] = await db
      .select({ id: companyNoticeAcksTable.id })
      .from(companyNoticeAcksTable)
      .where(
        and(
          eq(companyNoticeAcksTable.noticeId, noticeId),
          eq(companyNoticeAcksTable.memberClerkId, memberClerkIdRaw),
        ),
      );
    if (existingAck) {
      res
        .status(400)
        .json({ error: "This member has already read the notice" });
      return;
    }

    // Rate limit: look up the latest nudge (in-app notification row)
    // sent for this (notice, member) pair and reject if it's within the
    // window.
    const cutoff = new Date(Date.now() - NUDGE_RATE_LIMIT_MS);
    const [recent] = await db
      .select({ createdAt: notificationsTable.createdAt })
      .from(notificationsTable)
      .where(
        and(
          eq(notificationsTable.userClerkId, memberClerkIdRaw),
          eq(notificationsTable.type, COMPANY_NOTICE_NUDGE_TYPE),
          eq(notificationsTable.relatedId, String(noticeId)),
          gt(notificationsTable.createdAt, cutoff),
        ),
      )
      .orderBy(desc(notificationsTable.createdAt))
      .limit(1);
    if (recent) {
      const nextEligibleAt = new Date(
        recent.createdAt.getTime() + NUDGE_RATE_LIMIT_MS,
      );
      res.status(429).json({
        error: "This teammate was nudged recently. Try again later.",
        nextEligibleAt: nextEligibleAt.toISOString(),
      });
      return;
    }

    // Look up the company name + sender display so the notification copy
    // names what the recipient is being asked to read.
    const [company] = await db
      .select({
        companyName: outwardAccountsTable.companyName,
        title: outwardAccountsTable.title,
        displayName: outwardAccountsTable.displayName,
      })
      .from(outwardAccountsTable)
      .where(eq(outwardAccountsTable.id, notice.companyOutwardAccountId));
    const companyName =
      company?.companyName?.trim() ||
      company?.title?.trim() ||
      company?.displayName?.trim() ||
      null;
    const [sender] = await db
      .select({
        name: usersTable.name,
        username: usersTable.username,
      })
      .from(usersTable)
      .where(eq(usersTable.clerkId, userId));
    const senderLabel =
      sender?.name?.trim() ||
      (sender?.username ? `@${sender.username}` : "An admin");

    const nudgedAt = new Date();
    const inAppTitle = companyName
      ? `Reminder from ${companyName}`
      : "Reminder from your team";
    const inAppBody = `${senderLabel} is waiting for you to read "${notice.title}".`;
    try {
      await insertNotifications({
        userClerkId: memberClerkIdRaw,
        outwardAccountId: notice.companyOutwardAccountId,
        type: COMPANY_NOTICE_NUDGE_TYPE,
        title: inAppTitle,
        body: inAppBody,
        relatedId: String(noticeId),
      });
    } catch (err) {
      logger.error(
        { err, noticeId, memberClerkId: memberClerkIdRaw },
        "Failed to insert company-notice nudge notification",
      );
      res.status(500).json({ error: "Couldn't send the reminder" });
      return;
    }

    // Push is best-effort: if it fails the in-app notification is still
    // recorded and the recipient will see it next time they open the app.
    void sendPushToUsers([memberClerkIdRaw], {
      title: inAppTitle,
      body: inAppBody,
      data: {
        type: "company_notice",
        noticeId,
        companyOutwardAccountId: notice.companyOutwardAccountId,
      },
    });

    res.json({
      noticeId,
      memberClerkId: memberClerkIdRaw,
      nudgedAt: nudgedAt.toISOString(),
      nextEligibleAt: new Date(
        nudgedAt.getTime() + NUDGE_RATE_LIMIT_MS,
      ).toISOString(),
    });
  },
);

/**
 * DELETE /company-notices/:id — only the sender or another admin of
 * the same company skin can take a notice down.
 */
router.delete(
  "/company-notices/:noticeId",
  requireAuth,
  async (req, res): Promise<void> => {
    const { userId } = req as AuthRequest;
    const noticeId = parseId(req.params.noticeId);
    if (!Number.isFinite(noticeId) || noticeId <= 0) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const [notice] = await db
      .select()
      .from(companyNoticesTable)
      .where(eq(companyNoticesTable.id, noticeId));
    if (!notice) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const allowed =
      notice.senderClerkId === userId ||
      (await canAdministerCompany(userId, notice.companyOutwardAccountId));
    if (!allowed) {
      res.status(403).json({ error: "Not allowed" });
      return;
    }
    await db
      .delete(companyNoticeAcksTable)
      .where(eq(companyNoticeAcksTable.noticeId, noticeId));
    await db
      .delete(companyNoticesTable)
      .where(eq(companyNoticesTable.id, noticeId));
    res.sendStatus(204);
  },
);

export default router;
