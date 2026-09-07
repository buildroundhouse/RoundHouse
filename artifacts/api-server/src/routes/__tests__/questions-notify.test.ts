/**
 * Test for question / request push + in-feed notifications (task #470).
 *
 * Verifies that:
 *   - asking a pro a question pushes the pro and inserts a
 *     "question_asked" notification with a deep-link payload,
 *   - sending a "What I Need From You" request pushes the client and
 *     inserts a "request_received" notification,
 *   - a pro answering an Ask-a-Pro question pushes the asker and
 *     inserts a "question_answered" notification (only on the
 *     open → answered transition, not on confirm/edit),
 *   - the recipient's notification preference is honoured (an opted-out
 *     recipient gets neither push nor feed entry).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import express, { type Express } from "express";
import request from "supertest";
import { eq, inArray } from "drizzle-orm";

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.userId = String(req.headers["x-test-user"] ?? "");
    next();
  },
}));

const sendPushToUserMock = vi.fn().mockResolvedValue(undefined);
vi.mock("../../lib/push", () => ({
  sendPushToUser: (...args: unknown[]) => sendPushToUserMock(...args),
  sendPushToUsers: vi.fn().mockResolvedValue(undefined),
}));

const recordPointsMock = vi.fn().mockResolvedValue(undefined);
vi.mock("../../lib/rewards", () => ({
  recordPoints: (...args: unknown[]) => recordPointsMock(...args),
}));

const {
  db,
  notificationsTable,
  questionsTable,
  usersTable,
  userNotificationPrefsTable,
} = await import("@workspace/db");
const questionsRouter = (await import("../questions")).default;

const tag = `t470-${Date.now()}`;
const client = `${tag}-client`;
const pro = `${tag}-pro`;

let app: Express;

async function ensureUser(clerkId: string, name: string) {
  await db
    .insert(usersTable)
    .values({ clerkId, email: `${clerkId}@test.local`, name, username: clerkId })
    .onConflictDoNothing({ target: usersTable.clerkId });
}

async function cleanup() {
  await db
    .delete(questionsTable)
    .where(inArray(questionsTable.userClerkId, [client, pro]));
  await db
    .delete(notificationsTable)
    .where(inArray(notificationsTable.userClerkId, [client, pro]));
  await db
    .delete(userNotificationPrefsTable)
    .where(inArray(userNotificationPrefsTable.userClerkId, [client, pro]));
}

beforeAll(async () => {
  app = express();
  app.use(express.json());
  app.use(questionsRouter);
  await ensureUser(client, "Casey Client");
  await ensureUser(pro, "Pat Provider");
});

afterAll(async () => {
  await cleanup();
  await db.delete(usersTable).where(inArray(usersTable.clerkId, [client, pro]));
});

beforeEach(async () => {
  sendPushToUserMock.mockClear();
  await cleanup();
});

async function notificationsFor(clerkId: string) {
  return db
    .select()
    .from(notificationsTable)
    .where(eq(notificationsTable.userClerkId, clerkId));
}

describe("question notifications (#470)", () => {
  it("pushes the pro when a client asks a question", async () => {
    const res = await request(app)
      .post("/questions")
      .set("x-test-user", client)
      .send({
        kind: "ask_pro",
        counterpartyClerkId: pro,
        questionText: "Can you take a look at the leaky faucet?",
      });
    expect(res.status).toBe(201);
    const questionId: number = res.body.id;

    expect(sendPushToUserMock).toHaveBeenCalledTimes(1);
    expect(sendPushToUserMock).toHaveBeenCalledWith(
      pro,
      expect.objectContaining({
        title: expect.stringContaining("Casey Client"),
        data: expect.objectContaining({ type: "question", questionId }),
      }),
    );

    const inFeed = await notificationsFor(pro);
    expect(inFeed).toHaveLength(1);
    expect(inFeed[0]).toMatchObject({
      type: "question_asked",
      relatedId: String(questionId),
    });
  });

  it("pushes the client when a pro sends a 'What I Need From You' request", async () => {
    const res = await request(app)
      .post("/questions")
      .set("x-test-user", pro)
      .send({
        kind: "request",
        counterpartyClerkId: client,
        questionText: "Please confirm the appointment time.",
        requestedAction: "confirm",
      });
    expect(res.status).toBe(201);
    const questionId: number = res.body.id;

    expect(sendPushToUserMock).toHaveBeenCalledWith(
      client,
      expect.objectContaining({
        data: expect.objectContaining({ type: "question", questionId }),
      }),
    );
    const inFeed = await notificationsFor(client);
    expect(inFeed).toHaveLength(1);
    expect(inFeed[0].type).toBe("request_received");
  });

  it("pushes the asker when a pro answers their question", async () => {
    const created = await request(app)
      .post("/questions")
      .set("x-test-user", client)
      .send({
        kind: "ask_pro",
        counterpartyClerkId: pro,
        questionText: "Best paint for kitchen?",
      });
    expect(created.status).toBe(201);
    const questionId: number = created.body.id;
    sendPushToUserMock.mockClear();
    // Drop the "question_asked" feed item so we can assert the answer
    // entry in isolation.
    await db
      .delete(notificationsTable)
      .where(eq(notificationsTable.userClerkId, pro));

    const answered = await request(app)
      .patch(`/questions/${questionId}`)
      .set("x-test-user", pro)
      .send({ responseText: "Use a satin enamel finish." });
    expect(answered.status).toBe(200);

    expect(sendPushToUserMock).toHaveBeenCalledTimes(1);
    expect(sendPushToUserMock).toHaveBeenCalledWith(
      client,
      expect.objectContaining({
        title: expect.stringContaining("Pat Provider"),
        data: expect.objectContaining({ type: "question", questionId }),
      }),
    );
    const inFeed = await notificationsFor(client);
    expect(inFeed).toHaveLength(1);
    expect(inFeed[0].type).toBe("question_answered");

    // A subsequent confirm should not re-fire the answer push.
    sendPushToUserMock.mockClear();
    const confirmed = await request(app)
      .patch(`/questions/${questionId}`)
      .set("x-test-user", client)
      .send({ confirm: true });
    expect(confirmed.status).toBe(200);
    expect(sendPushToUserMock).not.toHaveBeenCalled();
  });

  it("respects the recipient's notification preference", async () => {
    await db.insert(userNotificationPrefsTable).values({
      userClerkId: pro,
      notificationType: "question_asked",
      enabled: false,
    });

    const res = await request(app)
      .post("/questions")
      .set("x-test-user", client)
      .send({
        kind: "ask_pro",
        counterpartyClerkId: pro,
        questionText: "Anything urgent?",
      });
    expect(res.status).toBe(201);

    expect(sendPushToUserMock).not.toHaveBeenCalled();
    const inFeed = await notificationsFor(pro);
    expect(inFeed).toHaveLength(0);
  });
});
