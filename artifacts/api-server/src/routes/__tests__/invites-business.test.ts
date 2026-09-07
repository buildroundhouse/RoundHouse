/**
 * End-to-end test for the business-invite endpoint that backs Find > Businesses.
 *
 * Covers task #198: "Send the invite email automatically instead of opening Mail".
 *
 * Exercises:
 *   - POST /invites/business validates the email and returns 400 on bad input.
 *   - When `SENDGRID_API_KEY` is missing the endpoint returns 503 so the
 *     modal can show "service not configured" instead of pretending to send.
 *   - When the key is set the endpoint stores a pending invite, calls the
 *     SendGrid HTTP API, marks the row sent, and echoes back the saved row.
 *   - When SendGrid responds with an error the row is marked failed and the
 *     endpoint returns 502 with a user-friendly error.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import express, { type Express } from "express";
import request from "supertest";
import { eq, inArray } from "drizzle-orm";

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    const uid = req.headers["x-test-user"];
    if (!uid) {
      _res.status(401).json({ error: "missing x-test-user" });
      return;
    }
    req.userId = String(uid);
    next();
  },
}));

const { db, businessInvitesTable, outwardAccountsTable, usersTable } = await import(
  "@workspace/db"
);
const invitesRouter = (await import("../invites")).default;

function makeApp(): Express {
  const app = express();
  app.use(express.json());
  app.use("/api", invitesRouter);
  return app;
}

const tag = `t198-${Date.now()}`;
const ownerId = `${tag}-owner`;

let app: Express;
const fetchMock = vi.fn();
const originalFetch = globalThis.fetch;

beforeAll(async () => {
  app = makeApp();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  // The route resolves the sender's outward account from the users row,
  // lazy-seeding one if needed. We just need the users row to exist.
  await db.insert(usersTable).values({
    clerkId: ownerId,
    email: `${tag}-owner@example.test`,
    name: "Olive Owner",
    username: `owner_${tag}`,
  });
});

afterAll(async () => {
  globalThis.fetch = originalFetch;
  const ownedAccountIds = (
    await db
      .select({ id: outwardAccountsTable.id })
      .from(outwardAccountsTable)
      .where(eq(outwardAccountsTable.ownerClerkId, ownerId))
  ).map((r) => r.id);
  if (ownedAccountIds.length > 0) {
    await db
      .delete(businessInvitesTable)
      .where(inArray(businessInvitesTable.senderOutwardAccountId, ownedAccountIds));
  }
  await db
    .update(usersTable)
    .set({ activeOutwardAccountId: null })
    .where(eq(usersTable.clerkId, ownerId));
  await db
    .delete(outwardAccountsTable)
    .where(eq(outwardAccountsTable.ownerClerkId, ownerId));
  await db.delete(usersTable).where(eq(usersTable.clerkId, ownerId));
});

beforeEach(() => {
  fetchMock.mockReset();
  delete process.env.SENDGRID_API_KEY;
});

describe("POST /invites/business", () => {
  it("rejects an invalid email with 400", async () => {
    process.env.SENDGRID_API_KEY = "SG.test";
    const res = await request(app)
      .post("/api/invites/business")
      .set("x-test-user", ownerId)
      .send({ email: "not-an-email", businessName: "ACME" });
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 503 when SENDGRID_API_KEY is missing so the modal can surface it", async () => {
    const res = await request(app)
      .post("/api/invites/business")
      .set("x-test-user", ownerId)
      .send({ email: `${tag}-noconfig@example.test`, businessName: "ACME Plumbing" });
    expect(res.status).toBe(503);
    expect(typeof res.body.error).toBe("string");
    // No invite row should be persisted when the service isn't set up.
    const rows = await db
      .select()
      .from(businessInvitesTable)
      .where(eq(businessInvitesTable.email, `${tag}-noconfig@example.test`));
    expect(rows).toHaveLength(0);
  });

  it("creates a sent invite and posts to SendGrid when the API key is set", async () => {
    process.env.SENDGRID_API_KEY = "SG.test";
    process.env.INVITE_LINK_BASE_URL = "https://test.roundhouse.app";
    fetchMock.mockResolvedValueOnce(new Response("", { status: 202 }));

    const recipient = `${tag}-ok@example.test`;
    const res = await request(app)
      .post("/api/invites/business")
      .set("x-test-user", ownerId)
      .send({ email: recipient, businessName: "ACME Plumbing" });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("sent");
    expect(res.body.email).toBe(recipient);
    expect(res.body.businessName).toBe("ACME Plumbing");
    expect(typeof res.body.sentAt).toBe("string");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.sendgrid.com/v3/mail/send");
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer SG.test");
    const payload = JSON.parse(init.body as string);
    expect(payload.personalizations[0].to[0].email).toBe(recipient);
    expect(payload.subject).toBe("Join me on Roundhouse");
    const textPart = payload.content.find((c: any) => c.type === "text/plain");
    expect(textPart.value).toContain("ACME Plumbing");
    expect(textPart.value).toContain("https://test.roundhouse.app/invite/business/");

    const [saved] = await db
      .select()
      .from(businessInvitesTable)
      .where(eq(businessInvitesTable.id, res.body.id));
    expect(saved.status).toBe("sent");
    expect(saved.sentAt).not.toBeNull();
    expect(saved.sendError).toBeNull();
  });

  it("marks the invite failed and returns 502 when SendGrid rejects the send", async () => {
    process.env.SENDGRID_API_KEY = "SG.test";
    fetchMock.mockResolvedValueOnce(
      new Response("rate limited", { status: 429 }),
    );

    const recipient = `${tag}-fail@example.test`;
    const res = await request(app)
      .post("/api/invites/business")
      .set("x-test-user", ownerId)
      .send({ email: recipient });

    expect(res.status).toBe(502);
    expect(typeof res.body.error).toBe("string");

    const rows = await db
      .select()
      .from(businessInvitesTable)
      .where(eq(businessInvitesTable.email, recipient));
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("failed");
    expect(rows[0].sendError).toContain("429");
    expect(rows[0].sentAt).toBeNull();

    // Cleanup the failure row alongside the success row.
    await db
      .delete(businessInvitesTable)
      .where(inArray(businessInvitesTable.email, [recipient]));
  });
});
