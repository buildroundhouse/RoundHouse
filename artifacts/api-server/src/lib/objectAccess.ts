import { eq, inArray, or, sql } from "drizzle-orm";
import {
  db,
  objectUploadsTable,
  propertiesTable,
  propertyNotesTable,
  propertySpecsTable,
  propertyStandardEvidenceTable,
  userModesTable,
  usersTable,
  workLogsTable,
  workOrdersTable,
} from "@workspace/db";
import { listMembershipsForUser } from "./propertyAccess";

function jsonbAttachmentMatches(column: unknown, objectPath: string) {
  return sql`jsonb_path_exists(${column as never}, '$[*] ? (@.path == $p)'::jsonpath, jsonb_build_object('p', ${objectPath}::text))`;
}

/**
 * Look up every propertyId that references the given canonical "/objects/<id>"
 * path through any known attachment column. We only authorize against columns
 * that the application controls server-side (specs/notes/work-orders/work-logs/
 * standard-evidence). User-controlled string columns (e.g. users.avatarUrl) are
 * intentionally NOT used as authorization input — a user could otherwise gain
 * read access by setting their own avatar to an arbitrary private object path.
 */
async function resolvePropertyIdsForObjectPath(objectPath: string): Promise<number[]> {
  const [coverRows, specRows, evidenceRows, noteRows, workOrderRows, workLogRows] = await Promise.all([
    db
      .select({ propertyId: propertiesTable.id })
      .from(propertiesTable)
      .where(eq(propertiesTable.coverPhotoUrl, objectPath)),
    db
      .select({ propertyId: propertySpecsTable.propertyId })
      .from(propertySpecsTable)
      .where(eq(propertySpecsTable.photoPath, objectPath)),
    db
      .select({ propertyId: propertyStandardEvidenceTable.propertyId })
      .from(propertyStandardEvidenceTable)
      .where(eq(propertyStandardEvidenceTable.photoPath, objectPath)),
    db
      .select({ propertyId: propertyNotesTable.propertyId })
      .from(propertyNotesTable)
      .where(jsonbAttachmentMatches(propertyNotesTable.attachments, objectPath)),
    db
      .select({ propertyId: workOrdersTable.propertyId })
      .from(workOrdersTable)
      .where(
        or(
          eq(workOrdersTable.photoUrl, objectPath),
          jsonbAttachmentMatches(workOrdersTable.attachments, objectPath),
        ),
      ),
    db
      .select({ propertyId: workLogsTable.propertyId })
      .from(workLogsTable)
      .where(
        or(
          eq(workLogsTable.photoUrl, objectPath),
          jsonbAttachmentMatches(workLogsTable.attachments, objectPath),
        ),
      ),
  ]);

  const ids = new Set<number>();
  for (const row of [...coverRows, ...specRows, ...evidenceRows, ...noteRows, ...workOrderRows, ...workLogRows]) {
    ids.add(row.propertyId);
  }
  return [...ids];
}

export class UploadOwnershipError extends Error {
  status = 403 as const;
  constructor(public readonly objectPath: string) {
    super(`Forbidden: object ${objectPath} was uploaded by another user`);
    this.name = "UploadOwnershipError";
  }
}

/**
 * Records that `userId` is the uploader of `objectPath`. Idempotent — keeps the
 * earliest uploader on conflict so a later caller can't reassign ownership.
 */
export async function recordObjectUpload(
  userId: string,
  objectPath: string,
  uploaderOutwardAccountId: number | null = null,
): Promise<void> {
  if (!objectPath) return;
  await db
    .insert(objectUploadsTable)
    .values({ objectPath, uploaderClerkId: userId, uploaderOutwardAccountId })
    .onConflictDoNothing({ target: objectUploadsTable.objectPath });
}

/**
 * Throws if the caller may not attach any of these object paths.
 *
 * For every path:
 *   - If object_uploads records an uploader, that uploader must be the caller
 *     (the normal "you uploaded this" case for newly-uploaded files).
 *   - If there is no upload record (legacy data uploaded before tracking
 *     started, or rare race conditions), the caller must already have read
 *     access to the path through an existing property reference. This avoids
 *     breaking re-saves of legacy attachments while still blocking attackers,
 *     because a user who is not already a member of a property containing the
 *     path can't expand access through this path.
 *
 * Call this from any route that persists user-supplied object paths into
 * property records (specs, notes, work orders, work logs, standard evidence,
 * user avatar). It is the write-side complement to canUserAccessObjectPath:
 * it prevents a user from stashing someone else's "/objects/<id>" inside their
 * own property's records to bypass the read-side membership check.
 */
export async function assertCallerOwnsUploads(
  userId: string,
  paths: Array<string | null | undefined>,
): Promise<void> {
  const unique = [...new Set(paths.filter((p): p is string => !!p && p.startsWith("/objects/")))];
  if (unique.length === 0) return;

  const rows = await db
    .select({ objectPath: objectUploadsTable.objectPath, uploaderClerkId: objectUploadsTable.uploaderClerkId })
    .from(objectUploadsTable)
    .where(inArray(objectUploadsTable.objectPath, unique));
  const existing = new Map(rows.map((r) => [r.objectPath, r.uploaderClerkId]));

  for (const p of unique) {
    const owner = existing.get(p);
    if (owner === userId) continue;
    if (owner) throw new UploadOwnershipError(p);
    // No upload record (legacy path). Allow only if the caller can already
    // read the path through an existing property reference.
    const allowed = await canUserAccessObjectPath(userId, p);
    if (!allowed) throw new UploadOwnershipError(p);
  }
}

/**
 * Returns true when the given user is allowed to read the object at objectPath.
 *
 * Authorization rule: the path must be referenced by at least one property
 * record (spec / note / work order / work log / standard evidence) on a
 * property the caller is a member of. Files that aren't attached to any record
 * are denied — clients should attach a freshly-uploaded file to a record before
 * trying to read it back through this route.
 *
 * Sharing model: every member of a property can read any file referenced by
 * that property's records. To share a file with someone, attach it to a record
 * on a property they belong to (or add them to a property whose records
 * already reference it).
 */
/**
 * Returns true when objectPath is currently set as some user's profile media
 * (avatar, company logo, or header background) AND the original uploader of
 * the path is that same user. Used by GET /storage/objects/* to serve profile
 * media without an Authorization header — React Native's <Image> can't attach
 * our Firebase bearer token, so requiring auth would 401 every profile photo.
 *
 * The uploader-match guard is what keeps this safe: PUT /users/me already
 * enforces that you can only set these fields to a path you uploaded, but we
 * re-verify here so the helper is sound in isolation. A user cannot make
 * another user's private object publicly readable by pointing a profile field
 * at it.
 */
export async function isPublicProfileMedia(objectPath: string): Promise<boolean> {
  const [profileOwnerRow] = await db
    .select({ clerkId: usersTable.clerkId })
    .from(usersTable)
    .where(
      or(
        eq(usersTable.avatarUrl, objectPath),
        eq(usersTable.companyLogoUrl, objectPath),
        eq(usersTable.headerImageUrl, objectPath),
      ),
    )
    .limit(1);
  // Per-account branding (banner / company logo) lives on user_modes.intake_data
  // since each account has its own branding. Treat those as profile media too.
  let ownerClerkId = profileOwnerRow?.clerkId ?? null;
  if (!ownerClerkId) {
    const [modeOwnerRow] = await db
      .select({ clerkId: userModesTable.userClerkId })
      .from(userModesTable)
      .where(
        or(
          sql`${userModesTable.intakeData}->>'headerImageUrl' = ${objectPath}`,
          sql`${userModesTable.intakeData}->>'companyLogoUrl' = ${objectPath}`,
          sql`${userModesTable.intakeData}->>'bannerUrl' = ${objectPath}`,
          sql`${userModesTable.intakeData}->>'coverPhotoUrl' = ${objectPath}`,
          sql`${userModesTable.intakeData}->>'logoUrl' = ${objectPath}`,
        ),
      )
      .limit(1);
    ownerClerkId = modeOwnerRow?.clerkId ?? null;
  }
  if (!ownerClerkId) return false;
  const profileOwnerRowFinal = { clerkId: ownerClerkId };

  const [uploadRow] = await db
    .select({ uploaderClerkId: objectUploadsTable.uploaderClerkId })
    .from(objectUploadsTable)
    .where(eq(objectUploadsTable.objectPath, objectPath))
    .limit(1);
  if (uploadRow) return uploadRow.uploaderClerkId === profileOwnerRowFinal.clerkId;

  // Legacy path uploaded before tracking started — accept since the only way
  // it ended up on the user record is via PUT /users/me, which already
  // enforced ownership at write time.
  return true;
}

export async function canUserAccessObjectPath(
  userId: string,
  objectPath: string,
): Promise<boolean> {
  // Allow if the path is currently set as someone's profile media (avatar,
  // company logo, or header background) AND the original uploader of the
  // path is that same user. The uploader-match check defends against the
  // spoof attack (user A pointing their profile field at user B's private
  // file): PUT /users/me already enforces that you can only set these
  // fields to a path you uploaded, but we re-verify here so this function
  // is safe in isolation. Profile media is treated as public — any signed
  // in user can fetch it (it backs public profile views).
  const [profileOwnerRow] = await db
    .select({ clerkId: usersTable.clerkId })
    .from(usersTable)
    .where(
      or(
        eq(usersTable.avatarUrl, objectPath),
        eq(usersTable.companyLogoUrl, objectPath),
        eq(usersTable.headerImageUrl, objectPath),
      ),
    )
    .limit(1);
  if (profileOwnerRow) {
    const [uploadRow] = await db
      .select({ uploaderClerkId: objectUploadsTable.uploaderClerkId })
      .from(objectUploadsTable)
      .where(eq(objectUploadsTable.objectPath, objectPath))
      .limit(1);
    if (uploadRow && uploadRow.uploaderClerkId === profileOwnerRow.clerkId) {
      return true;
    }
    if (!uploadRow && profileOwnerRow.clerkId === userId) {
      return true;
    }
  }

  const propertyIds = await resolvePropertyIdsForObjectPath(objectPath);
  if (propertyIds.length === 0) return false;

  const memberships = await listMembershipsForUser(userId);
  const allowed = new Set(propertyIds);
  return memberships.some((m) => allowed.has(m.propertyId));
}
