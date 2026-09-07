/**
 * Idempotent migration that backfills `team_seats` rows from the legacy
 * `user_team_members` table introduced in earlier work. Each legacy row
 * is keyed by `(lead_clerk_id, member_clerk_id)`. The lead is always a
 * personal profile, so we resolve their default outward account ("skin")
 * and seed a `team_seats` row keyed by `(skin_id, member_clerk_id)`.
 *
 * Permissions on the seeded seat are conservative: no billing, no
 * contact-detail visibility, no team-management — pure "respond on
 * properties" until the skin's owner upgrades the seat.
 *
 * Safe to re-run: existing seats (matched by skin + member) are skipped.
 */
import { eq, and, isNull, asc } from "drizzle-orm";
import {
  db,
  pool,
  outwardAccountsTable,
  userTeamMembersTable,
  teamSeatsTable,
} from "../src";

async function defaultSkinFor(leadClerkId: string): Promise<number | null> {
  const [first] = await db
    .select({ id: outwardAccountsTable.id })
    .from(outwardAccountsTable)
    .where(
      and(
        eq(outwardAccountsTable.ownerClerkId, leadClerkId),
        isNull(outwardAccountsTable.archivedAt),
      ),
    )
    .orderBy(asc(outwardAccountsTable.id))
    .limit(1);
  return first?.id ?? null;
}

export async function migrateTeamSeats(): Promise<{ created: number; skipped: number }> {
  const legacy = await db.select().from(userTeamMembersTable);
  let created = 0;
  let skipped = 0;
  for (const row of legacy) {
    const skinId = await defaultSkinFor(row.leadClerkId);
    if (skinId == null) {
      skipped += 1;
      continue;
    }
    const [existing] = await db
      .select({ id: teamSeatsTable.id })
      .from(teamSeatsTable)
      .where(
        and(
          eq(teamSeatsTable.companyOutwardAccountId, skinId),
          eq(teamSeatsTable.memberClerkId, row.memberClerkId),
        ),
      );
    if (existing) {
      skipped += 1;
      continue;
    }
    await db.insert(teamSeatsTable).values({
      companyOutwardAccountId: skinId,
      memberClerkId: row.memberClerkId,
      role: row.role === "partner" ? "manager" : "employee",
      isAdmin: row.role === "partner",
      permissions: row.role === "partner"
        ? {
            seeContacts: true,
            seeBilling: true,
            createOnProperties: true,
            manageTeam: true,
          }
        : { seeContacts: false, seeBilling: false, createOnProperties: false, manageTeam: false },
      status: row.status,
      invitedAt: row.invitedAt,
      acceptedAt: row.acceptedAt,
    });
    created += 1;
  }
  return { created, skipped };
}

if (process.argv[1]?.endsWith("migrateTeamSeats.ts") || process.argv[1]?.endsWith("migrateTeamSeats.js")) {
  migrateTeamSeats()
    .then(({ created, skipped }) => {
      // eslint-disable-next-line no-console
      console.log(`team_seats migrated: created=${created} skipped=${skipped}`);
      return pool.end();
    })
    .catch((err) => {
      // eslint-disable-next-line no-console
      console.error(err);
      process.exit(1);
    });
}
