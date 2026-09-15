export const CALENDAR_STEPS = [
  {
    name: "calendar_appointments",
    sql: `CREATE TABLE IF NOT EXISTS calendar_appointments (
    id serial PRIMARY KEY, business_id integer, property_entity_id integer NOT NULL, property_id integer,
    property_name text NOT NULL, address text NOT NULL, created_by text NOT NULL, creator_account_id integer NOT NULL,
    title text NOT NULL, starts_at timestamptz NOT NULL, duration integer NOT NULL CHECK (duration BETWEEN 5 AND 1440),
    status text NOT NULL CHECK (status IN ('proposed','pending','confirmed','cancelled')), parties jsonb NOT NULL, events jsonb NOT NULL,
    revision integer NOT NULL DEFAULT 1, updated_at timestamptz NOT NULL DEFAULT now());`,
  },
  {
    name: "calendar_scope",
    sql: `CREATE INDEX IF NOT EXISTS calendar_scope ON calendar_appointments (business_id, starts_at);`,
  },
  {
    name: "calendar_unavailable",
    sql: `CREATE TABLE IF NOT EXISTS calendar_unavailable (id serial PRIMARY KEY, user_id text NOT NULL, starts_at timestamptz NOT NULL, ends_at timestamptz NOT NULL, CHECK(ends_at > starts_at));`,
  },
  {
    name: "calendar_availability",
    sql: `CREATE TABLE IF NOT EXISTS calendar_availability (id serial PRIMARY KEY, user_id text NOT NULL, starts_at timestamptz NOT NULL, ends_at timestamptz NOT NULL, CHECK(ends_at > starts_at));`,
  },
  {
    name: "calendar_availability_user",
    sql: `CREATE INDEX IF NOT EXISTS calendar_availability_user ON calendar_availability (user_id, starts_at);`,
  },
];
