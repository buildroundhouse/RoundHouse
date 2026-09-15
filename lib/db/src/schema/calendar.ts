import {
  pgTable,
  serial,
  integer,
  text,
  timestamp,
  jsonb,
} from "drizzle-orm/pg-core";
export type CalendarParty = {
  accountId: number;
  userId: string;
  name: string;
  role: "worker" | "independent" | "homeowner";
  required: boolean;
  response: "pending" | "accepted" | "declined" | "suggested";
  message?: string;
  suggestedAt?: string;
};
export type CalendarEvent = {
  action: string;
  actorId: string;
  at: string;
  startsAt?: string;
  duration?: number;
  message?: string;
};
export const calendarAppointmentsTable = pgTable("calendar_appointments", {
  id: serial("id").primaryKey(),
  businessId: integer("business_id"),
  propertyEntityId: integer("property_entity_id").notNull(),
  propertyId: integer("property_id"),
  propertyName: text("property_name").notNull(),
  address: text("address").notNull(),
  createdBy: text("created_by").notNull(),
  creatorAccountId: integer("creator_account_id").notNull(),
  title: text("title").notNull(),
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
  duration: integer("duration").notNull(),
  status: text("status").notNull(),
  parties: jsonb("parties").$type<CalendarParty[]>().notNull(),
  events: jsonb("events").$type<CalendarEvent[]>().notNull(),
  revision: integer("revision").notNull().default(1),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
export const calendarUnavailableTable = pgTable("calendar_unavailable", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
  endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
});
