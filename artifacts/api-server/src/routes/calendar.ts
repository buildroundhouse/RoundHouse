import { Router } from "express";
import { and, eq, inArray, isNull, sql, asc, lt, gt } from "drizzle-orm";
import {
  db,
  entitiesTable,
  entityMembersTable,
  usersTable,
  outwardAccountsTable,
  notificationsTable,
  calendarAppointmentsTable as appointments,
  calendarUnavailableTable as unavailable,
  type CalendarParty,
} from "@workspace/db";
import { requireAuth, type AuthRequest } from "../middlewares/requireAuth";
import { resolutionAccess } from "../lib/resolutionAccess";
import {
  manager,
  operational,
  scheduleInput,
  confirmationStatus,
  respond,
  CalendarError,
} from "../lib/calendar";
const router = Router();
type Appointment = typeof appointments.$inferSelect;
async function scopeFor(req: AuthRequest) {
  const a = await resolutionAccess(req);
  const ids = a.memberships.map((m) => m.entityId);
  const entities = ids.length
    ? await db
        .select()
        .from(entitiesTable)
        .where(
          and(inArray(entitiesTable.id, ids), isNull(entitiesTable.archivedAt)),
        )
    : [];
  const active = operational(a.kind);
  const managed = entities.filter(
    (e) => active && manager(a.memberships.find((m) => m.entityId === e.id)),
  );
  return {
    ...a,
    entities,
    active,
    businesses: managed.filter((e) => e.kind === "business"),
    homes: managed.filter((e) => e.kind !== "business"),
    properties: entities.filter(
      (e) =>
        e.kind !== "business" &&
        active &&
        !["viewer", "collaborator"].includes(
          a.memberships.find((m) => m.entityId === e.id)!.role,
        ),
    ),
  };
}
type Scope = Awaited<ReturnType<typeof scopeFor>>;
const manages = (d: Appointment, s: Scope) =>
  s.properties.some((p) => p.id === d.propertyEntityId) &&
  (d.businessId
    ? s.businesses.some((b) => b.id === d.businessId)
    : s.homes.some((p) => p.id === d.propertyEntityId));
const partyFor = (d: Appointment, r: AuthRequest) =>
  d.parties.find(
    (p) => p.accountId === r.activeOutwardAccountId && p.userId === r.userId,
  );
function visible(d: Appointment, r: AuthRequest, s: Scope) {
  if (manages(d, s)) return true;
  if (d.status === "proposed") return false;
  if (s.homes.some((p) => p.id === d.propertyEntityId)) return true;
  const p = partyFor(d, r);
  return (
    !!p &&
    s.active &&
    s.properties.some((e) => e.id === d.propertyEntityId) &&
    (p.role !== "worker" || d.status === "confirmed")
  );
}
function present(d: Appointment, r: AuthRequest, s: Scope) {
  const canManage = manages(d, s),
    self = partyFor(d, r);
  // The dispatch board owns negotiation history; invitees receive only their appointment and response.
  return {
    ...d,
    parties: canManage
      ? d.parties
      : d.parties.filter((p) => p.accountId === r.activeOutwardAccountId),
    events: canManage
      ? d.events
      : d.events.filter(
          (e) =>
            ["created", "rescheduled", "published", "cancelled"].includes(
              e.action,
            ) || e.actorId === r.userId,
        ),
    canManage,
    canRespond:
      !!self?.required &&
      s.active &&
      !["proposed", "cancelled"].includes(d.status),
    myAssignment: !!self && self.role !== "homeowner",
    clientAccountId: canManage
      ? d.parties.find((p) => p.role === "homeowner")?.accountId
      : undefined,
    clientUserId: canManage
      ? d.parties.find((p) => p.role === "homeowner")?.userId
      : undefined,
  };
}
async function candidates(
  s: Scope,
  businessId: number | null,
  propertyId: number,
  executor: Pick<typeof db, "select"> = db,
) {
  const ids = [propertyId, ...(businessId ? [businessId] : [])];
  return executor
    .select({
      membership: entityMembersTable,
      name: usersTable.name,
      kind: outwardAccountsTable.kind,
    })
    .from(entityMembersTable)
    .innerJoin(
      usersTable,
      eq(usersTable.clerkId, entityMembersTable.userClerkId),
    )
    .innerJoin(
      outwardAccountsTable,
      eq(outwardAccountsTable.id, entityMembersTable.userOutwardAccountId),
    )
    .where(
      and(
        inArray(entityMembersTable.entityId, ids),
        eq(entityMembersTable.status, "approved"),
        isNull(entityMembersTable.archivedAt),
        isNull(outwardAccountsTable.archivedAt),
      ),
    );
}
function wrap(fn: (r: AuthRequest, res: any) => Promise<void>) {
  return async (req: any, res: any) => {
    try {
      await fn(req, res);
    } catch (e) {
      if (e instanceof CalendarError) {
        res.status(e.status).json({ error: e.message });
        return;
      }
      throw e;
    }
  };
}
router.get(
  "/calendar",
  requireAuth,
  wrap(async (r, res) => {
    const s = await scopeFor(r);
    const ids = s.properties.map((p) => p.id);
    const rows = ids.length
      ? await db
          .select()
          .from(appointments)
          .where(inArray(appointments.propertyEntityId, ids))
          .orderBy(asc(appointments.startsAt))
      : [];
    res.json({
      appointments: rows
        .filter((d) => visible(d, r, s))
        .map((d) => present(d, r, s)),
      canSchedule: !!(s.businesses.length || s.homes.length),
    });
  }),
);
router.get(
  "/calendar/daily",
  requireAuth,
  wrap(async (r, res) => {
    // Personal Daily Grind aggregates only the person's confirmed assignments across their accounts.
    const rows = await db
      .select()
      .from(appointments)
      .where(
        and(
          eq(appointments.status, "confirmed"),
          sql`${appointments.parties} @> ${JSON.stringify([{ userId: r.userId }])}::jsonb`,
        ),
      )
      .orderBy(asc(appointments.startsAt));
    const memberships = await db
      .select({
        entityId: entityMembersTable.entityId,
        accountId: entityMembersTable.userOutwardAccountId,
        kind: outwardAccountsTable.kind,
      })
      .from(entityMembersTable)
      .innerJoin(
        entitiesTable,
        eq(entitiesTable.id, entityMembersTable.entityId),
      )
      .innerJoin(
        outwardAccountsTable,
        eq(outwardAccountsTable.id, entityMembersTable.userOutwardAccountId),
      )
      .where(
        and(
          eq(entityMembersTable.userClerkId, r.userId),
          eq(entityMembersTable.status, "approved"),
          isNull(entityMembersTable.archivedAt),
          isNull(entitiesTable.archivedAt),
          isNull(outwardAccountsTable.archivedAt),
        ),
      );
    res.json({
      appointments: rows
        .filter((d) =>
          d.parties.some(
            (p) =>
              p.userId === r.userId &&
              memberships.some(
                (m) =>
                  m.entityId === d.propertyEntityId &&
                  m.accountId === p.accountId &&
                  operational(m.kind),
              ),
          ),
        )
        .map((d) => ({
          id: d.id,
          title: d.title,
          startsAt: d.startsAt,
          duration: d.duration,
          propertyName: d.propertyName,
          propertyId: d.propertyId,
          address: d.address,
        })),
    });
  }),
);
router.get(
  "/calendar/contexts",
  requireAuth,
  wrap(async (r, res) => {
    const s = await scopeFor(r);
    const properties = s.properties.filter(
      (p) => s.businesses.length || s.homes.some((h) => h.id === p.id),
    );
    res.json({
      businesses: s.businesses.map((b) => ({ id: b.id, name: b.name })),
      properties: await Promise.all(
        properties.map(async (p) => {
          const rows = await candidates(s, null, p.id);
          return {
            id: p.id,
            name: p.name,
            canScheduleOwn: s.homes.some((h) => h.id === p.id),
            people: rows
              .filter(
                (x) =>
                  operational(x.kind) &&
                  !["viewer", "collaborator"].includes(x.membership.role),
              )
              .map((x) => ({
                accountId: x.membership.userOutwardAccountId,
                name: x.name || "Team member",
                homeowner: manager(x.membership),
              })),
          };
        }),
      ),
    });
  }),
);
router.post(
  "/calendar",
  requireAuth,
  wrap(async (r, res) => {
    const s = await scopeFor(r),
      b = r.body ?? {};
    const businessId = b.businessId == null ? null : Number(b.businessId),
      propertyId = Number(b.propertyEntityId);
    const property = s.properties.find((p) => p.id === propertyId);
    if (
      !r.activeOutwardAccountId ||
      !property ||
      (businessId
        ? !s.businesses.some((e) => e.id === businessId)
        : !s.homes.some((e) => e.id === propertyId))
    )
      throw new CalendarError(
        403,
        "Scheduling requires an Owner or Manager and access to this Property.",
      );
    const title = typeof b.title === "string" ? b.title.trim() : "";
    if (!title || title.length > 200)
      throw new CalendarError(
        400,
        "Enter an appointment title (up to 200 characters).",
      );
    const time = scheduleInput(b),
      rows = await candidates(s, businessId, propertyId);
    if (
      !Array.isArray(b.accountIds) ||
      !b.accountIds.length ||
      b.accountIds.length > 50 ||
      !b.accountIds.every(Number.isSafeInteger)
    )
      throw new CalendarError(
        400,
        "Select the assigned people and required homeowner.",
      );
    const parties: CalendarParty[] = [...new Set<number>(b.accountIds)].map(
      (id) => {
        const x = rows.find(
          (x) =>
            x.membership.entityId === propertyId &&
            x.membership.userOutwardAccountId === id,
        );
        if (
          !x ||
          !operational(x.kind) ||
          ["viewer", "collaborator"].includes(x.membership.role)
        )
          throw new CalendarError(
            403,
            "Every participant must have current access to this Property.",
          );
        const employee = rows.some(
          (e) =>
            e.membership.entityId === businessId &&
            e.membership.userOutwardAccountId === id &&
            ["owner", "admin", "manager", "employee"].includes(
              e.membership.role,
            ) &&
            e.membership.permissions?.classification !==
              "outside_service_provider",
        );
        const role =
          manager(x.membership) && !employee
            ? "homeowner"
            : employee
              ? "worker"
              : "independent";
        return {
          accountId: id,
          userId: x.membership.userClerkId,
          name: x.name || "Team member",
          role,
          required: role !== "worker",
          response: role === "worker" ? "accepted" : "pending",
        };
      },
    );
    const links = await db.execute(
      sql`SELECT p.id, p.address FROM property_entity_links l JOIN properties p ON p.id=l.property_id WHERE l.entity_id=${propertyId} LIMIT 1`,
    );
    const link = links.rows[0];
    const [d] = await db
      .insert(appointments)
      .values({
        businessId,
        propertyEntityId: propertyId,
        propertyId: link ? Number(link.id) : null,
        propertyName: property.name,
        address: String(link?.address || ""),
        createdBy: r.userId,
        creatorAccountId: r.activeOutwardAccountId,
        title,
        ...time,
        status: "proposed",
        parties,
        events: [
          {
            action: "created",
            actorId: r.userId,
            at: new Date().toISOString(),
            startsAt: time.startsAt.toISOString(),
            duration: time.duration,
          },
        ],
      })
      .returning();
    res.status(201).json(present(d, r, s));
  }),
);
router.post(
  "/calendar/:id/actions",
  requireAuth,
  wrap(async (r, res) => {
    const s = await scopeFor(r),
      b = r.body ?? {};
    const result = await db.transaction(async (tx) => {
      const [d] = await tx
        .select()
        .from(appointments)
        .where(eq(appointments.id, Number(r.params.id) || -1))
        .for("update");
      if (!d || !visible(d, r, s))
        throw new CalendarError(404, "Appointment not found.");
      if (b.revision !== d.revision)
        throw new CalendarError(
          409,
          "This appointment changed. Refresh before responding.",
        );
      const action = b.action,
        canManage = manages(d, s);
      const currentPeople = await candidates(
        s,
        d.businessId,
        d.propertyEntityId,
        tx,
      );
      const currentParty = (p: CalendarParty) =>
        currentPeople.some(
          (x) =>
            x.membership.entityId === d.propertyEntityId &&
            x.membership.userOutwardAccountId === p.accountId &&
            x.membership.userClerkId === p.userId &&
            operational(x.kind) &&
            !["viewer", "collaborator"].includes(x.membership.role),
        );
      if (
        ["publish", "reschedule", "accept"].includes(action) &&
        !d.parties.every(currentParty)
      )
        throw new CalendarError(
          409,
          "A participant no longer has Property access. Cancel this appointment and create a new proposal with the current team.",
        );
      if (d.status === "cancelled")
        throw new CalendarError(409, "This appointment was cancelled.");
      if (["publish", "reschedule", "cancel"].includes(action)) {
        if (!canManage)
          throw new CalendarError(
            403,
            "Only the scheduling Owner or Manager can change this appointment.",
          );
        if (action === "publish") {
          if (d.status !== "proposed")
            throw new CalendarError(
              409,
              "This appointment has already been published.",
            );
          d.status = confirmationStatus(d.parties);
        } else if (action === "reschedule") {
          const time = scheduleInput(b);
          Object.assign(d, time);
          d.parties = d.parties.map((p) => ({
            ...p,
            response: p.required ? "pending" : "accepted",
            message: undefined,
            suggestedAt: undefined,
          }));
          if (d.status !== "proposed") d.status = confirmationStatus(d.parties);
        } else d.status = "cancelled";
      } else {
        if (d.status === "proposed" || !partyFor(d, r) || !s.active)
          throw new CalendarError(
            403,
            "This appointment is not awaiting your response.",
          );
        d.parties = respond(
          d.parties,
          r.activeOutwardAccountId!,
          action,
          b.message,
          b.suggestedAt,
        );
        d.status = confirmationStatus(d.parties);
      }
      if (
        ["publish", "reschedule"].includes(action) &&
        d.status !== "proposed"
      ) {
        const conflicts = await tx
          .select()
          .from(unavailable)
          .where(
            and(
              inArray(
                unavailable.userId,
                d.parties.map((p) => p.userId),
              ),
              lt(
                unavailable.startsAt,
                new Date(d.startsAt.getTime() + d.duration * 60000),
              ),
              gt(unavailable.endsAt, d.startsAt),
            ),
          );
        if (conflicts.length)
          throw new CalendarError(
            409,
            "An assigned participant is Unavailable at this time. Choose another time.",
          );
      }
      d.events = [
        ...d.events,
        {
          action:
            action === "reschedule"
              ? "rescheduled"
              : action === "publish"
                ? "published"
                : action === "cancel"
                  ? "cancelled"
                  : action,
          actorId: r.userId,
          at: new Date().toISOString(),
          startsAt: d.startsAt.toISOString(),
          duration: d.duration,
          message:
            typeof b.message === "string"
              ? b.message.trim().slice(0, 2000)
              : undefined,
        },
      ];
      const [saved] = await tx
        .update(appointments)
        .set({
          startsAt: d.startsAt,
          duration: d.duration,
          parties: d.parties,
          status: d.status,
          events: d.events,
          revision: d.revision + 1,
          updatedAt: new Date(),
        })
        .where(eq(appointments.id, d.id))
        .returning();
      if (d.status !== "proposed") {
        const recipients = new Map(
          d.parties
            .filter(currentParty)
            .filter(
              (p) =>
                p.required ||
                d.status === "confirmed" ||
                action === "cancel" ||
                action === "reschedule",
            )
            .map((p) => [p.accountId, p.userId]),
        );
        if (
          currentPeople.some(
            (x) =>
              x.membership.entityId === d.propertyEntityId &&
              x.membership.userOutwardAccountId === d.creatorAccountId &&
              operational(x.kind),
          )
        )
          recipients.set(d.creatorAccountId, d.createdBy);
        for (const [accountId, userId] of recipients)
          if (accountId !== r.activeOutwardAccountId)
            await tx.insert(notificationsTable).values({
              userClerkId: userId,
              outwardAccountId: accountId,
              type: "calendar",
              title: "Appointment updated",
              body: `${d.propertyName} · ${d.startsAt.toISOString()} · ${d.status === "pending" ? "Pending Confirmation" : d.status}`,
              relatedId: String(d.id),
            });
      }
      return saved;
    });
    res.json(present(result, r, s));
  }),
);
router.get(
  "/calendar-unavailable",
  requireAuth,
  wrap(async (r, res) => {
    res.json({
      blocks: await db
        .select()
        .from(unavailable)
        .where(eq(unavailable.userId, r.userId))
        .orderBy(asc(unavailable.startsAt)),
    });
  }),
);
router.post(
  "/calendar-unavailable",
  requireAuth,
  wrap(async (r, res) => {
    if (r.body?.removeId) {
      await db
        .delete(unavailable)
        .where(
          and(
            eq(unavailable.id, Number(r.body.removeId)),
            eq(unavailable.userId, r.userId),
          ),
        );
      res.json({ ok: true });
      return;
    }
    const { startsAt, duration } = scheduleInput(r.body ?? {});
    const [block] = await db
      .insert(unavailable)
      .values({
        userId: r.userId,
        startsAt,
        endsAt: new Date(startsAt.getTime() + duration * 60000),
      })
      .returning();
    res.status(201).json(block);
  }),
);
export default router;
