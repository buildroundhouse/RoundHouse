import { Router, type IRouter } from "express";
import { eq, and, desc, inArray } from "drizzle-orm";
import {
  db,
  propertiesTable,
  propertyMemberEventsTable,
  propertySpecsTable,
  propertyNotesTable,
  workLogsTable,
  usersTable,
} from "@workspace/db";
import { requireAuth, type AuthRequest } from "../middlewares/requireAuth";
import { requirePaidCapability } from "../lib/capabilities";
import { publicUserColumns } from "../lib/userPublic";
import { ObjectStorageService } from "../lib/objectStorage";
import { assertCallerOwnsUploads } from "../lib/objectAccess";
import {
  canReadCollaboratorNote,
  effectiveRole,
  getMembershipForProperty,
  upsertPropertyMembership,
} from "../lib/propertyAccess";

// #503 — Outside service providers must not see property-wide knowledge
// (specs, notes). They reach the property only through their own
// assigned work orders.
function denyOspPropertyRead(m: { role: string; classification?: string | null } | null | undefined) {
  return effectiveRole(m) === "outside_service_provider";
}

const router: IRouter = Router();

type AttachmentInput = {
  path?: unknown;
  kind?: unknown;
  name?: unknown;
  contentType?: unknown;
  size?: unknown;
};

function normalizeAttachments(input: unknown): { path: string; kind: "image" | "file"; name?: string; contentType?: string; size?: number }[] | null {
  if (!Array.isArray(input)) return null;
  const out: { path: string; kind: "image" | "file"; name?: string; contentType?: string; size?: number }[] = [];
  for (const raw of input as AttachmentInput[]) {
    if (!raw || typeof raw !== "object") continue;
    const path = typeof raw.path === "string" ? raw.path : "";
    const kind = raw.kind === "image" || raw.kind === "file" ? raw.kind : null;
    if (!path || !kind) continue;
    out.push({
      path,
      kind,
      ...(typeof raw.name === "string" ? { name: raw.name } : {}),
      ...(typeof raw.contentType === "string" ? { contentType: raw.contentType } : {}),
      ...(typeof raw.size === "number" ? { size: raw.size } : {}),
    });
  }
  return out;
}

const objectStorage = new ObjectStorageService();
function normalizePhotoPath(input: unknown): string | null | undefined {
  if (input === undefined) return undefined;
  if (input === null || input === "") return null;
  if (typeof input !== "string") return undefined;
  try {
    return objectStorage.normalizeObjectEntityPath(input);
  } catch {
    return input;
  }
}

async function getMembership(propertyId: number, userId: string) {
  return getMembershipForProperty(propertyId, userId);
}

function canEdit(role?: string) {
  return role === "owner" || role === "admin";
}

// #503 — Effective per-property classification used by the permission
// matrix. Legacy memberships (no `classification`) fall back to their
// `role`, so existing owner/admin paths keep working unchanged.
function effectiveClassification(m: { role: string; classification?: string | null } | undefined | null): string {
  if (!m) return "";
  if (m.role === "owner") return "owner";
  if (m.role === "admin") return "admin";
  return m.classification || m.role;
}

// Spec/standard-style edits: structural property data.
// Owner / admin / Trade Pro Worker only. Outside service providers and
// collaborators are not allowed to mutate property knowledge.
function canEditPropertyKnowledge(m: { role: string; classification?: string | null } | undefined | null): boolean {
  const eff = effectiveClassification(m);
  return eff === "owner" || eff === "admin" || eff === "worker";
}

function parseId(raw: string | string[] | undefined): number {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return parseInt(String(v), 10);
}

async function attachAuthor<T extends { authorClerkId: string }>(rows: T[]) {
  const ids = [...new Set(rows.map((r) => r.authorClerkId))];
  const users = ids.length
    ? await db.select(publicUserColumns).from(usersTable).where(inArray(usersTable.clerkId, ids))
    : [];
  const map = Object.fromEntries(users.map((u) => [u.clerkId, u]));
  return rows.map((r) => ({ ...r, author: map[r.authorClerkId] }));
}

// ---------- Specs ----------
router.get("/properties/:propertyId/specs", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthRequest;
  const propertyId = parseId(req.params.propertyId);
  const m = await getMembership(propertyId, userId);
  if (!m) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  if (denyOspPropertyRead(m)) {
    res.status(403).json({
      error: "Outside service providers can only access their own assigned work.",
    });
    return;
  }
  const specs = await db
    .select()
    .from(propertySpecsTable)
    .where(eq(propertySpecsTable.propertyId, propertyId))
    .orderBy(propertySpecsTable.category, propertySpecsTable.key);
  res.json({ specs });
});

router.post("/properties/:propertyId/specs", requireAuth, async (req, res): Promise<void> => {
  const ar = req as AuthRequest;
  const { userId } = ar;
  const propertyId = parseId(req.params.propertyId);
  const m = await getMembership(propertyId, userId);
  if (!m || !canEditPropertyKnowledge(m)) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  if (!(await requirePaidCapability(ar, res, "create_property_records"))) return;
  const { key, value, category, photoPath } = req.body;
  if (!key || typeof key !== "string") {
    res.status(400).json({ error: "key is required" });
    return;
  }
  const normalizedPhoto = normalizePhotoPath(photoPath);
  await assertCallerOwnsUploads(userId, [normalizedPhoto]);
  const [spec] = await db
    .insert(propertySpecsTable)
    .values({
      propertyId,
      key: String(key),
      value: value ? String(value) : "",
      category: category ? String(category) : "general",
      photoPath: normalizedPhoto ?? null,
      authorClerkId: userId,
    })
    .returning();
  res.status(201).json(spec);
});

router.put("/properties/:propertyId/specs/:specId", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthRequest;
  const propertyId = parseId(req.params.propertyId);
  const specId = parseId(req.params.specId);
  const m = await getMembership(propertyId, userId);
  if (!m || !canEditPropertyKnowledge(m)) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  const { key, value, category, photoPath } = req.body;
  const updates: Record<string, unknown> = {};
  if (key != null) updates.key = String(key);
  if (value != null) updates.value = String(value);
  if (category != null) updates.category = String(category);
  const normalizedPhoto = normalizePhotoPath(photoPath);
  if (normalizedPhoto !== undefined) {
    await assertCallerOwnsUploads(userId, [normalizedPhoto]);
    updates.photoPath = normalizedPhoto;
  }
  const [existing] = await db
    .select()
    .from(propertySpecsTable)
    .where(and(eq(propertySpecsTable.id, specId), eq(propertySpecsTable.propertyId, propertyId)));
  if (!existing) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const [spec] = await db
    .update(propertySpecsTable)
    .set(updates)
    .where(and(eq(propertySpecsTable.id, specId), eq(propertySpecsTable.propertyId, propertyId)))
    .returning();
  if (!spec) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  if (normalizedPhoto !== undefined && existing.photoPath) {
    const oldNormalized = normalizePhotoPath(existing.photoPath) ?? existing.photoPath;
    if (oldNormalized !== normalizedPhoto) {
      await objectStorage.deleteObjectEntity(existing.photoPath);
    }
  }
  res.json(spec);
});

router.delete("/properties/:propertyId/specs/:specId", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthRequest;
  const propertyId = parseId(req.params.propertyId);
  const specId = parseId(req.params.specId);
  const m = await getMembership(propertyId, userId);
  if (!m || !canEditPropertyKnowledge(m)) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  const [removed] = await db
    .delete(propertySpecsTable)
    .where(and(eq(propertySpecsTable.id, specId), eq(propertySpecsTable.propertyId, propertyId)))
    .returning();
  if (!removed) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  if (removed.photoPath) {
    await objectStorage.deleteObjectEntity(removed.photoPath);
  }
  res.sendStatus(204);
});

// ---------- Notes ----------
// #503 — Note visibility & permission rules:
//   - owner / admin / worker:           may post/edit/delete public ("all") notes;
//                                        can read all notes including collaborator-private
//   - outside_service_provider:         may post public notes; can NOT see
//                                        collaborator-private notes
//   - collaborator (read-only):         may post collaborator-private notes only;
//                                        sees public notes + their own private notes
//   - everyone:                         may always edit/delete their own note
router.get("/properties/:propertyId/notes", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthRequest;
  const propertyId = parseId(req.params.propertyId);
  const m = await getMembership(propertyId, userId);
  if (!m) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  if (denyOspPropertyRead(m)) {
    res.status(403).json({
      error: "Outside service providers can only access their own assigned work.",
    });
    return;
  }
  const notes = await db
    .select()
    .from(propertyNotesTable)
    .where(eq(propertyNotesTable.propertyId, propertyId))
    .orderBy(desc(propertyNotesTable.isPinned), desc(propertyNotesTable.updatedAt));

  // #503 — Owner, admins, the property's Trade Pro Worker(s), and any
  // accepted owner-teammate (team_seats.memberClerkId on the owner's
  // company outward account) may read collaborator-private notes.
  // Everyone else only sees `visibility = 'all'` notes plus their own
  // private notes. Owner-teammates are resolved authoritatively here
  // via canReadCollaboratorNote rather than the previous worker-class
  // approximation.
  const canSeeAllPrivate = await canReadCollaboratorNote({
    propertyId,
    viewerClerkId: userId,
    membership: m,
  });
  const filtered = notes.filter(
    (n) => n.visibility === "all" || canSeeAllPrivate || n.authorClerkId === userId,
  );
  const enriched = await attachAuthor(filtered);
  res.json({ notes: enriched });
});

router.post("/properties/:propertyId/notes", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthRequest;
  const propertyId = parseId(req.params.propertyId);
  const m = await getMembership(propertyId, userId);
  if (!m) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  if (denyOspPropertyRead(m)) {
    res.status(403).json({
      error: "Outside service providers can only access their own assigned work.",
    });
    return;
  }
  const { title, body, isPinned, attachments, visibility: rawVisibility } = req.body;
  if (body == null || typeof body !== "string" || !body.trim()) {
    res.status(400).json({ error: "body is required" });
    return;
  }
  const eff = effectiveClassification(m);
  // Resolve requested visibility, defaulting to "all" for managers and
  // to "collaborator_private" for collaborators.
  let visibility: "all" | "collaborator_private";
  if (rawVisibility === "collaborator_private") {
    visibility = "collaborator_private";
  } else if (rawVisibility === "all") {
    visibility = "all";
  } else {
    visibility = eff === "collaborator" ? "collaborator_private" : "all";
  }
  // Permission gate per visibility.
  if (visibility === "all") {
    // Read-only collaborators may not post public notes.
    if (eff === "collaborator") {
      res.status(403).json({ error: "Collaborators may only post private notes" });
      return;
    }
    // Anyone else with a membership may post a public note.
  } else {
    // Anyone with a membership may post a private note (it'll only be
    // visible to managers + themselves).
  }
  // Read-only collaborators cannot pin notes (a manager privilege).
  const wantsPin = !!isPinned;
  if (wantsPin && eff === "collaborator") {
    res.status(403).json({ error: "Only managers may pin notes" });
    return;
  }
  const normalizedAttachments = normalizeAttachments(attachments) ?? [];
  const persisted = normalizedAttachments.map((a) => ({ ...a, path: normalizePhotoPath(a.path) ?? a.path }));
  await assertCallerOwnsUploads(userId, persisted.map((a) => a.path));
  const [note] = await db
    .insert(propertyNotesTable)
    .values({
      propertyId,
      authorClerkId: userId,
      title: title ? String(title) : "",
      body: String(body),
      isPinned: wantsPin,
      visibility,
      attachments: persisted,
    })
    .returning();
  const [enriched] = await attachAuthor([note]);
  res.status(201).json(enriched);
});

router.put("/properties/:propertyId/notes/:noteId", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthRequest;
  const propertyId = parseId(req.params.propertyId);
  const noteId = parseId(req.params.noteId);
  const m = await getMembership(propertyId, userId);
  if (!m) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  if (denyOspPropertyRead(m)) {
    res.status(403).json({
      error: "Outside service providers can only access their own assigned work.",
    });
    return;
  }
  // Authors may always edit their own note; otherwise must be a manager.
  const [maybeExisting] = await db
    .select()
    .from(propertyNotesTable)
    .where(and(eq(propertyNotesTable.id, noteId), eq(propertyNotesTable.propertyId, propertyId)));
  if (!maybeExisting) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  if (maybeExisting.authorClerkId !== userId && !canEditPropertyKnowledge(m)) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  const existing = maybeExisting;
  const { title, body, isPinned, attachments, visibility: rawVisibility } = req.body;
  const updates: Record<string, unknown> = {};
  if (title != null) updates.title = String(title);
  if (body != null) updates.body = String(body);
  if (isPinned != null) {
    // Read-only collaborators may not pin notes (manager privilege).
    if (!!isPinned && effectiveClassification(m) === "collaborator") {
      res.status(403).json({ error: "Only managers may pin notes" });
      return;
    }
    updates.isPinned = !!isPinned;
  }
  if (rawVisibility === "all" || rawVisibility === "collaborator_private") {
    // Collaborators cannot promote a private note to public.
    if (rawVisibility === "all" && effectiveClassification(m) === "collaborator") {
      res.status(403).json({ error: "Collaborators may only post private notes" });
      return;
    }
    updates.visibility = rawVisibility;
  }
  let removedPaths: string[] = [];
  if (attachments !== undefined) {
    const normalizedAttachments = normalizeAttachments(attachments) ?? [];
    const persisted = normalizedAttachments.map((a) => ({ ...a, path: normalizePhotoPath(a.path) ?? a.path }));
    await assertCallerOwnsUploads(userId, persisted.map((a) => a.path));
    updates.attachments = persisted;
    const newPaths = new Set(persisted.map((a) => a.path));
    const oldAttachments = Array.isArray(existing.attachments) ? (existing.attachments as { path?: unknown }[]) : [];
    for (const a of oldAttachments) {
      const p = typeof a?.path === "string" ? a.path : "";
      if (!p) continue;
      const normalized = normalizePhotoPath(p) ?? p;
      if (!newPaths.has(normalized) && !newPaths.has(p)) removedPaths.push(p);
    }
  }
  const [updated] = await db
    .update(propertyNotesTable)
    .set(updates)
    .where(eq(propertyNotesTable.id, noteId))
    .returning();
  for (const p of removedPaths) {
    await objectStorage.deleteObjectEntity(p);
  }
  const [enriched] = await attachAuthor([updated]);
  res.json(enriched);
});

router.delete("/properties/:propertyId/notes/:noteId", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthRequest;
  const propertyId = parseId(req.params.propertyId);
  const noteId = parseId(req.params.noteId);
  const m = await getMembership(propertyId, userId);
  if (!m) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  if (denyOspPropertyRead(m)) {
    res.status(403).json({
      error: "Outside service providers can only access their own assigned work.",
    });
    return;
  }
  const [existing] = await db
    .select()
    .from(propertyNotesTable)
    .where(and(eq(propertyNotesTable.id, noteId), eq(propertyNotesTable.propertyId, propertyId)));
  if (!existing) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  // Authors may delete their own note; otherwise must be a manager.
  if (existing.authorClerkId !== userId && !canEditPropertyKnowledge(m)) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  await db.delete(propertyNotesTable).where(eq(propertyNotesTable.id, noteId));
  const oldAttachments = Array.isArray(existing.attachments) ? (existing.attachments as { path?: unknown }[]) : [];
  for (const a of oldAttachments) {
    const p = typeof a?.path === "string" ? a.path : "";
    if (p) await objectStorage.deleteObjectEntity(p);
  }
  res.sendStatus(204);
});

// ---------- Membership (current user) ----------
router.get("/properties/:propertyId/members/me", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthRequest;
  const propertyId = parseId(req.params.propertyId);
  const m = await getMembership(propertyId, userId);
  if (!m) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  const isFirstVisit = m.firstVisitedAt == null;
  if (isFirstVisit && m.userOutwardAccountId != null) {
    await upsertPropertyMembership({
      propertyId,
      userClerkId: userId,
      userOutwardAccountId: m.userOutwardAccountId,
      firstVisitedAt: new Date(),
    });
  }
  const ageMs = Date.now() - new Date(m.createdAt).getTime();
  const isRecentlyAdded = ageMs < 7 * 24 * 60 * 60 * 1000;
  const welcomeDismissedAt = m.welcomeDismissedAt;
  res.json({
    propertyId,
    role: m.role,
    joinedAt: m.createdAt,
    firstVisitedAt: isFirstVisit ? new Date().toISOString() : m.firstVisitedAt,
    isFirstVisit,
    isRecentlyAdded,
    welcomeDismissedAt: welcomeDismissedAt ? welcomeDismissedAt.toISOString() : null,
    shouldShowOnboarding: (isFirstVisit || isRecentlyAdded) && !welcomeDismissedAt,
  });
});

router.post(
  "/properties/:propertyId/members/me/dismiss-welcome",
  requireAuth,
  async (req, res): Promise<void> => {
    const { userId } = req as AuthRequest;
    const propertyId = parseId(req.params.propertyId);
    const m = await getMembership(propertyId, userId);
    if (!m) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    const dismissedAt = m.welcomeDismissedAt ?? new Date();
    if (!m.welcomeDismissedAt && m.userOutwardAccountId != null) {
      await upsertPropertyMembership({
        propertyId,
        userClerkId: userId,
        userOutwardAccountId: m.userOutwardAccountId,
        welcomeDismissedAt: dismissedAt,
      });
    }
    res.json({
      propertyId,
      welcomeDismissedAt: dismissedAt.toISOString(),
    });
  },
);

router.post(
  "/properties/:propertyId/members/me/reset-welcome",
  requireAuth,
  async (req, res): Promise<void> => {
    const { userId } = req as AuthRequest;
    const propertyId = parseId(req.params.propertyId);
    const m = await getMembership(propertyId, userId);
    if (!m) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    if (m.welcomeDismissedAt && m.userOutwardAccountId != null) {
      await upsertPropertyMembership({
        propertyId,
        userClerkId: userId,
        userOutwardAccountId: m.userOutwardAccountId,
        welcomeDismissedAt: null,
      });
    }
    res.json({
      propertyId,
      welcomeDismissedAt: null,
    });
  },
);

// ---------- Onboarding ----------
router.get("/properties/:propertyId/onboarding", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthRequest;
  const propertyId = parseId(req.params.propertyId);
  const m = await getMembership(propertyId, userId);
  if (!m) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const [property] = await db.select().from(propertiesTable).where(eq(propertiesTable.id, propertyId));
  if (!property) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  const [user] = await db.select(publicUserColumns).from(usersTable).where(eq(usersTable.clerkId, userId));
  const membershipWithUser = { ...m, user };

  const specs = await db
    .select()
    .from(propertySpecsTable)
    .where(eq(propertySpecsTable.propertyId, propertyId))
    .orderBy(propertySpecsTable.category, propertySpecsTable.key);

  const notesRaw = await db
    .select()
    .from(propertyNotesTable)
    .where(and(eq(propertyNotesTable.propertyId, propertyId), eq(propertyNotesTable.isPinned, true)))
    .orderBy(desc(propertyNotesTable.updatedAt));
  const pinnedNotes = await attachAuthor(notesRaw);

  const logsRaw = await db
    .select()
    .from(workLogsTable)
    .where(eq(workLogsTable.propertyId, propertyId))
    .orderBy(desc(workLogsTable.createdAt))
    .limit(10);

  const logAuthorIds = [...new Set(logsRaw.map((l) => l.authorClerkId))];
  const logAuthors = logAuthorIds.length
    ? await db.select(publicUserColumns).from(usersTable).where(inArray(usersTable.clerkId, logAuthorIds))
    : [];
  const authorMap = Object.fromEntries(logAuthors.map((u) => [u.clerkId, u]));
  const recentLogs = logsRaw.map((l) => ({ ...l, author: authorMap[l.authorClerkId], property }));

  const joinedAt = m.createdAt;
  const ageMs = Date.now() - new Date(joinedAt).getTime();
  const isNewMember = ageMs < 7 * 24 * 60 * 60 * 1000;

  res.json({
    property,
    membership: membershipWithUser,
    joinedAt,
    isNewMember,
    specs,
    pinnedNotes,
    recentLogs,
  });
});

// ---------- Handoff ----------
router.get("/properties/:propertyId/handoff", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthRequest;
  const propertyId = parseId(req.params.propertyId);
  const m = await getMembership(propertyId, userId);
  if (!m) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const [property] = await db.select().from(propertiesTable).where(eq(propertiesTable.id, propertyId));
  if (!property) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  const events = await db
    .select()
    .from(propertyMemberEventsTable)
    .where(eq(propertyMemberEventsTable.propertyId, propertyId))
    .orderBy(propertyMemberEventsTable.createdAt);

  const userIds = [...new Set(events.map((e) => e.userClerkId))];
  const users = userIds.length
    ? await db.select(publicUserColumns).from(usersTable).where(inArray(usersTable.clerkId, userIds))
    : [];
  const userMap = Object.fromEntries(users.map((u) => [u.clerkId, u]));

  const entries = await Promise.all(
    events.map(async (e) => {
      const logsRaw = await db
        .select()
        .from(workLogsTable)
        .where(and(eq(workLogsTable.propertyId, propertyId), eq(workLogsTable.authorClerkId, e.userClerkId)))
        .orderBy(desc(workLogsTable.createdAt))
        .limit(5);
      const author = userMap[e.userClerkId];
      const lastLogs = logsRaw.map((l) => ({ ...l, author, property }));

      const notesRaw = await db
        .select()
        .from(propertyNotesTable)
        .where(
          and(
            eq(propertyNotesTable.propertyId, propertyId),
            eq(propertyNotesTable.authorClerkId, e.userClerkId),
            eq(propertyNotesTable.isPinned, true),
          ),
        )
        .orderBy(desc(propertyNotesTable.updatedAt));
      const pinnedNotes = notesRaw.map((n) => ({ ...n, author }));

      return {
        eventType: e.eventType,
        eventAt: e.createdAt,
        user: author,
        role: e.role,
        lastLogs,
        pinnedNotes,
      };
    }),
  );

  res.json({ entries });
});

export default router;
