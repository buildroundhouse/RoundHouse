import { beforeAll, afterAll, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { getTableColumns, getTableName } from "drizzle-orm";
import express from "express";
import request from "supertest";
import * as schema from "../../../../../lib/db/src/schema/index";
import { CALENDAR_STEPS } from "../../../../../lib/db/src/calendar-schema";
const state = vi.hoisted(() => ({ db: null as any }));
vi.mock("@workspace/db", async () => ({
  ...(await import("../../../../../lib/db/src/schema/index")),
  get db() {
    return state.db;
  },
}));
vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, res: any, next: any) => {
    if (!req.headers["x-test-user"]) return res.sendStatus(401);
    req.userId = req.headers["x-test-user"];
    req.activeOutwardAccountId = Number(req.headers["x-test-account"]);
    next();
  },
}));
vi.mock("../../lib/outwardAccounts", () => ({
  resolveActiveOutwardAccountId: () => null,
}));
const pg = new PGlite(),
  app = express();
app.use(express.json());
const client = (
  method: "get" | "post",
  path: string,
  user = "trade",
  account = 10,
) =>
  request(app)
    [method]("/api" + path)
    .set("x-test-user", user)
    .set("x-test-account", String(account));
let id: number, revision: number;
const time = "2026-10-01T10:00:00.000Z";
const action = (name: string, user = "trade", account = 10, extra = {}) =>
  client("post", `/calendar/${id}/actions`, user, account).send({
    action: name,
    revision,
    ...extra,
  });
beforeAll(async () => {
  state.db = drizzle(pg);
  for (const table of [
    schema.entitiesTable,
    schema.entityMembersTable,
    schema.outwardAccountsTable,
    schema.usersTable,
    schema.notificationsTable,
  ]) {
    const columns = Object.values(getTableColumns(table))
      .map((c) => `"${c.name}" ${c.getSQLType()}`)
      .join(", ");
    await pg.exec(`CREATE TABLE "${getTableName(table)}" (${columns})`);
  }
  for (const step of CALENDAR_STEPS) await pg.exec(step.sql);
  for (const step of CALENDAR_STEPS) await pg.exec(step.sql);
  await pg.exec(`CREATE TABLE property_entity_links (property_id integer, entity_id integer); CREATE TABLE properties (id integer, address text);
    INSERT INTO properties VALUES (100,'12 Oak Street'); INSERT INTO property_entity_links VALUES(100,2);
    INSERT INTO users (clerk_id, name) VALUES ('trade','Trade Owner'),('client','Home Client'),('worker','Worker'),('sub','Subcontractor'),('viewer','Viewer');
    INSERT INTO outward_accounts (id, owner_clerk_id, kind) VALUES (10,'trade','trade_pro'),(20,'client','home'),(30,'worker','trade_pro_teammate'),(40,'viewer','collab'),(50,'trade','home'),(60,'sub','trade');
    INSERT INTO entities (id, kind, name) VALUES (1,'business','Workshop'),(2,'residential_property','Oak Home'),(3,'residential_property','Other Home');
    INSERT INTO entity_members (entity_id,user_clerk_id,user_outward_account_id,role,status,permissions) VALUES
      (1,'trade',10,'owner','approved','{}'),(2,'trade',10,'worker','approved','{}'),(3,'trade',10,'worker','approved','{}'),
      (2,'client',20,'owner','approved','{}'),(1,'worker',30,'employee','approved','{}'),(2,'worker',30,'worker','approved','{}'),
      (2,'sub',60,'worker','approved','{}'),(2,'viewer',40,'collaborator','approved','{}');`);
  app.use("/api", (await import("../calendar")).default);
});
afterAll(async () => {
  await pg.close();
});
describe.sequential(
  "Calendar scheduling permissions and confirmation lifecycle",
  () => {
    it("only exposes scheduling contexts to managers/homeowners", async () => {
      const r = await client("get", "/calendar/contexts").expect(200);
      expect(r.body.businesses).toHaveLength(1);
      for (const [user, account] of [
        ["worker", 30],
        ["sub", 60],
        ["viewer", 40],
      ] as const) {
        const r = await client(
          "get",
          "/calendar/contexts",
          user,
          account,
        ).expect(200);
        expect(r.body.properties).toEqual([]);
        await client("post", "/calendar", user, account)
          .send({ businessId: 1, propertyEntityId: 2 })
          .expect(403);
      }
    });
    it("creates a proposal without sharing the dispatch board with workers/subcontractors", async () => {
      const r = await client("post", "/calendar")
        .send({
          businessId: 1,
          propertyEntityId: 2,
          title: "Kitchen repair",
          startsAt: time,
          duration: 90,
          accountIds: [20, 30, 60],
        })
        .expect(201);
      id = r.body.id;
      revision = r.body.revision;
      expect(r.body.status).toBe("proposed");
      expect(r.body.propertyId).toBe(100);
      for (const [user, account] of [
        ["worker", 30],
        ["sub", 60],
        ["viewer", 40],
        ["trade", 50],
      ] as const) {
        const r = await client("get", "/calendar", user, account).expect(200);
        expect(r.body.appointments).toEqual([]);
      }
      const daily = await client("get", "/calendar/daily", "worker", 30).expect(
        200,
      );
      expect(daily.body.appointments).toEqual([]);
    });
    it("publishes lightweight requests and requires every required approval", async () => {
      let r = await action("publish").expect(200);
      revision = r.body.revision;
      expect(r.body.status).toBe("pending");
      r = await client("get", "/calendar", "sub", 60).expect(200);
      expect(r.body.appointments[0].parties).toHaveLength(1);
      expect(r.body.appointments[0].canManage).toBe(false);
      await action("reschedule", "sub", 60, {
        startsAt: time,
        duration: 60,
      }).expect(403);
      r = await action("accept", "client", 20).expect(200);
      revision = r.body.revision;
      expect(r.body.status).toBe("pending");
      r = await action("accept", "sub", 60).expect(200);
      revision = r.body.revision;
      expect(r.body.status).toBe("confirmed");
      const daily = await client("get", "/calendar/daily", "worker", 30).expect(
        200,
      );
      expect(daily.body.appointments).toHaveLength(1);
      const worker = await client("get", "/calendar", "worker", 30).expect(200);
      expect(worker.body.appointments[0].canRespond).toBe(false);
    });
    it("reschedules with immutable history, resets approvals, removes unconfirmed work from Daily Grind", async () => {
      const oldRevision = revision;
      const r = await action("reschedule", "trade", 10, {
        startsAt: "2026-10-02T11:00:00.000Z",
        duration: 120,
      }).expect(200);
      revision = r.body.revision;
      expect(r.body.status).toBe("pending");
      expect(r.body.events[0].startsAt).toBe(time);
      expect(
        r.body.parties
          .filter((p: any) => p.required)
          .every((p: any) => p.response === "pending"),
      ).toBe(true);
      await client("post", `/calendar/${id}/actions`, "client", 20)
        .send({ action: "accept", revision: oldRevision })
        .expect(409);
      expect(
        (await client("get", "/calendar/daily", "worker", 30)).body
          .appointments,
      ).toEqual([]);
    });
    it("supports decline, alternative time and message without creating Resolutions", async () => {
      let r = await action("decline", "sub", 60).expect(200);
      revision = r.body.revision;
      expect(r.body.status).toBe("pending");
      r = await action("suggest", "sub", 60, {
        suggestedAt: "2026-10-03T10:00:00Z",
        message: "Can we do Saturday?",
      }).expect(200);
      revision = r.body.revision;
      expect(r.body.parties[0].response).toBe("suggested");
      r = await action("message", "sub", 60, {
        message: "Morning is best.",
      }).expect(200);
      revision = r.body.revision;
      expect(r.body.events.at(-1).message).toBe("Morning is best.");
    });
    it("keeps private commitments private and prevents publishing over Unavailable", async () => {
      await client("post", "/calendar-unavailable", "worker", 30)
        .send({ startsAt: "2026-10-04T10:00:00Z", duration: 120 })
        .expect(201);
      await action("reschedule", "trade", 10, {
        startsAt: "2026-10-04T10:00:00Z",
        duration: 60,
      }).expect(409);
      expect(
        (await client("get", "/calendar-unavailable")).body.blocks,
      ).toEqual([]);
      const rows = await pg.query<{ revision: number }>(
        "SELECT revision FROM calendar_appointments WHERE id=$1",
        [id],
      );
      expect(rows.rows[0].revision).toBe(revision);
    });
    it("stores personal open availability across account views without exposing it to others", async () => {
      const created = await client("post", "/calendar-availability")
        .send({
          startsAt: "2026-10-05T09:00:00Z",
          duration: 180,
        })
        .expect(201);
      const personal = await client(
        "get",
        "/calendar-availability",
        "trade",
        50,
      ).expect(200);
      expect(personal.body.slots).toHaveLength(1);
      expect(personal.body.slots[0].id).toBe(created.body.id);
      expect(
        (await client("get", "/calendar-availability", "client", 20)).body
          .slots,
      ).toEqual([]);
      await client("post", "/calendar-availability")
        .send({ startsAt: "2026-10-05T10:00:00Z", duration: 30 })
        .expect(409);
      await client("post", "/calendar-availability")
        .send({ removeId: created.body.id })
        .expect(200);
      expect(
        (await client("get", "/calendar-availability")).body.slots,
      ).toEqual([]);
    });
    it("denies removed participants and unauthenticated access", async () => {
      await pg.exec(
        "UPDATE entity_members SET status='removed' WHERE user_clerk_id='sub'",
      );
      await action("accept", "sub", 60).expect(404);
      await request(app).get("/api/calendar").expect(401);
    });
  },
);
