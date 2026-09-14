import { Router } from "express";
import { eq } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
import { requireAuth, type AuthRequest } from "../middlewares/requireAuth";
import { assertCallerOwnsUploads } from "../lib/objectAccess";

const router = Router();

// The entry form no longer asks for a public username. Preserve that existing
// identifier and save the new name/photo flow to the same personal user row.
router.put("/users/me/entry-profile", requireAuth, async (req, res) => {
  const { userId } = req as AuthRequest;
  const clean = (key: string) => typeof req.body?.[key] === "string" ? req.body[key].trim() : "";
  const firstName = clean("firstName"), lastName = clean("lastName"), nickname = clean("nickname"), phone = clean("phone");
  const avatarUrl = clean("avatarUrl");
  if (!firstName || !lastName || firstName.length > 80 || lastName.length > 80 || nickname.length > 80 || phone.length > 40) {
    res.status(400).json({ error: "Enter your first and last name, and check your phone number." });
    return;
  }
  const [user] = await db.select().from(usersTable).where(eq(usersTable.clerkId, userId));
  if (!user) {
    res.status(409).json({ error: "Your profile is still loading. Please try again." });
    return;
  }
  if (!avatarUrl) {
    res.status(400).json({ error: "Add a profile photo to continue." });
    return;
  }
  if (avatarUrl !== user.avatarUrl && !avatarUrl.startsWith("/objects/")) {
    // A small JPEG thumbnail is durable even before external file storage is
    // connected. Never persist device-local blob/file URIs or arbitrary URLs.
    const jpeg = /^data:image\/jpeg;base64,([A-Za-z0-9+/]+={0,2})$/.exec(avatarUrl);
    const bytes = jpeg && avatarUrl.length <= 65000 ? Buffer.from(jpeg[1], "base64") : null;
    if (!bytes || bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff || bytes.at(-2) !== 0xff || bytes.at(-1) !== 0xd9) {
      res.status(400).json({ error: "Please select your profile photo again." });
      return;
    }
  }
  await assertCallerOwnsUploads(userId, [avatarUrl]);
  const [updated] = await db.update(usersTable).set({
    name: `${nickname || firstName} ${lastName}`,
    phone: phone || null,
    avatarUrl,
    identityCompletedAt: user.identityCompletedAt ?? new Date(),
  }).where(eq(usersTable.clerkId, userId)).returning();
  res.setHeader("Cache-Control", "no-store");
  res.json(updated);
});

export default router;
