/**
 * One-shot, idempotent migration to bring any environment's database up
 * to the current Drizzle schema *without* running `drizzle-kit push --force`.
 *
 * The push-force path is destructive: when a NOT NULL column is added to
 * a table that still has rows, drizzle-kit happily truncates the table
 * to make the constraint hold. That is what wiped `user_connections` /
 * `app_invites` / `business_invites` rows the last time someone did a
 * "fresh setup" — see task #361.
 *
 * This script does the opposite: every step is safe to re-run, never
 * drops a column, never truncates a table, and only tightens NOT NULL
 * constraints once the corresponding backfill has filled every row.
 *
 * Run it with:
 *
 *     pnpm --filter @workspace/db migrate
 *
 * Steps performed:
 *
 *   1. Schema sync (raw DDL): create any missing table / column / index
 *      that the current schema files declare.
 *   2. Data backfill 1: `migrateOutwardAccounts` — seeds a default
 *      outward account for every user and stamps owner/member/work-order
 *      rows with that account.
 *   3. Legacy column backfill: copy `*_clerk_id` → `*_outward_account_id`
 *      on `user_connections`, `app_invites`, `business_invites` using
 *      each user's seeded default outward account.
 *   4. Data backfill 2: `migrateTeamSeats` — seeds team_seats rows from
 *      the legacy `user_team_members` table.
 *   5. Tighten NOT NULL constraints on the new outward-account columns
 *      once every row has a value. Skipped if any rows are still NULL
 *      (so re-running on a partially-backfilled DB is safe).
 *
 * The DDL deliberately uses `ADD COLUMN IF NOT EXISTS`,
 * `CREATE TABLE IF NOT EXISTS`, and `CREATE INDEX IF NOT EXISTS` so this
 * is safe to run on a fresh database, on the current dev DB, and on the
 * production DB (whichever generation it is on).
 */
import { pool } from "../src";
import { migrateOutwardAccounts } from "./migrateOutwardAccounts";
import { migrateTeamSeats } from "./migrateTeamSeats";
import { backfillCommentAuthorOutwardAccount } from "./backfillCommentAuthorOutwardAccount";

type Step = { name: string; sql: string };

export const SCHEMA_STEPS: Step[] = [
  // --- users -------------------------------------------------------------
  {
    name: "users.active_outward_account_id",
    sql: `ALTER TABLE users ADD COLUMN IF NOT EXISTS active_outward_account_id integer;`,
  },
  {
    name: "users.stripe_customer_id",
    sql: `ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_customer_id text;`,
  },
  {
    name: "users.expo_push_token",
    sql: `ALTER TABLE users ADD COLUMN IF NOT EXISTS expo_push_token text;`,
  },
  {
    name: "users.push_token_updated_at",
    sql: `ALTER TABLE users ADD COLUMN IF NOT EXISTS push_token_updated_at timestamptz;`,
  },
  {
    name: "users.notify_job_started",
    sql: `ALTER TABLE users ADD COLUMN IF NOT EXISTS notify_job_started boolean NOT NULL DEFAULT true;`,
  },
  {
    name: "users.notify_job_completed",
    sql: `ALTER TABLE users ADD COLUMN IF NOT EXISTS notify_job_completed boolean NOT NULL DEFAULT true;`,
  },
  {
    name: "users.address_zip",
    sql: `ALTER TABLE users ADD COLUMN IF NOT EXISTS address_zip text;`,
  },
  {
    name: "users.service_zips",
    sql: `ALTER TABLE users ADD COLUMN IF NOT EXISTS service_zips jsonb NOT NULL DEFAULT '[]'::jsonb;`,
  },
  {
    name: "users.sponsor_brand_name",
    sql: `ALTER TABLE users ADD COLUMN IF NOT EXISTS sponsor_brand_name text;`,
  },
  {
    name: "users.last_active_mode_id",
    sql: `ALTER TABLE users ADD COLUMN IF NOT EXISTS last_active_mode_id integer;`,
  },
  {
    name: "users.identity_completed_at",
    sql: `ALTER TABLE users ADD COLUMN IF NOT EXISTS identity_completed_at timestamptz;`,
  },

  {
    name: "users.stripe_customer_id",
    sql: `ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_customer_id text;`,
  },

  // --- outward_accounts --------------------------------------------------
  {
    name: "outward_accounts table",
    sql: `
      CREATE TABLE IF NOT EXISTS outward_accounts (
        id serial PRIMARY KEY,
        owner_clerk_id text NOT NULL,
        kind text NOT NULL,
        title text,
        display_name text,
        avatar_url text,
        banner_url text,
        company_name text,
        bio text,
        capability_state text NOT NULL DEFAULT 'standard',
        last_initial_only boolean NOT NULL DEFAULT false,
        source_user_mode_id integer,
        created_at timestamptz NOT NULL DEFAULT now(),
        archived_at timestamptz
      );
    `,
  },
  {
    name: "outward_accounts.capability_state (legacy DBs)",
    sql: `ALTER TABLE outward_accounts ADD COLUMN IF NOT EXISTS capability_state text NOT NULL DEFAULT 'standard';`,
  },
  {
    name: "outward_accounts.source_user_mode_id (legacy DBs)",
    sql: `ALTER TABLE outward_accounts ADD COLUMN IF NOT EXISTS source_user_mode_id integer;`,
  },
  {
    name: "outward_accounts.archived_at (legacy DBs)",
    sql: `ALTER TABLE outward_accounts ADD COLUMN IF NOT EXISTS archived_at timestamptz;`,
  },
  {
    // #640 — per-skin "show owner's last initial only" toggle. Existing
    // rows inherit OFF (the column default) so legacy skins keep their
    // current name rendering until the owner explicitly flips it.
    name: "outward_accounts.last_initial_only (#640)",
    sql: `ALTER TABLE outward_accounts ADD COLUMN IF NOT EXISTS last_initial_only boolean NOT NULL DEFAULT false;`,
  },
  {
    name: "outward_accounts indexes",
    sql: `
      CREATE INDEX IF NOT EXISTS outward_accounts_owner_idx
        ON outward_accounts (owner_clerk_id);
      CREATE INDEX IF NOT EXISTS outward_accounts_source_mode_idx
        ON outward_accounts (source_user_mode_id);
    `,
  },

  // --- properties --------------------------------------------------------
  {
    name: "properties.owner_outward_account_id",
    sql: `
      ALTER TABLE properties ADD COLUMN IF NOT EXISTS owner_outward_account_id integer;
      CREATE INDEX IF NOT EXISTS properties_owner_outward_idx
        ON properties (owner_outward_account_id);
    `,
  },

  // --- property_members (retired in task #681) --------------------------
  // The legacy `property_members` table has been dropped; membership now
  // lives in `entity_members` via the property → entity link table, and
  // the table is dropped on every boot via `migratePropertyEntities`,
  // which also no-ops gracefully on any database that somehow still has
  // the legacy table. Its previous ADD COLUMN / index steps were removed
  // here, so no schema steps are needed.

  // --- property_notes (#503 visibility scope) ---------------------------
  {
    name: "property_notes.visibility_503",
    sql: `
      ALTER TABLE property_notes
        ADD COLUMN IF NOT EXISTS visibility text NOT NULL DEFAULT 'all';
    `,
  },

  // --- property_member_events -------------------------------------------
  {
    name: "property_member_events outward columns",
    sql: `
      ALTER TABLE property_member_events ADD COLUMN IF NOT EXISTS subject_outward_account_id integer;
      ALTER TABLE property_member_events ADD COLUMN IF NOT EXISTS actor_outward_account_id integer;
    `,
  },

  // --- work_orders -------------------------------------------------------
  {
    name: "work_orders outward columns",
    sql: `
      ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS assignee_outward_account_id integer;
      ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS created_by_outward_account_id integer;
      CREATE INDEX IF NOT EXISTS work_orders_created_by_outward_idx
        ON work_orders (created_by_outward_account_id);
      CREATE INDEX IF NOT EXISTS work_orders_assignee_outward_idx
        ON work_orders (assignee_outward_account_id);
    `,
  },

  // --- messages ----------------------------------------------------------
  {
    name: "messages outward + acted_by columns",
    sql: `
      ALTER TABLE messages ADD COLUMN IF NOT EXISTS sender_outward_account_id integer;
      ALTER TABLE messages ADD COLUMN IF NOT EXISTS recipient_outward_account_id integer;
      ALTER TABLE messages ADD COLUMN IF NOT EXISTS acted_by_clerk_id text;
      ALTER TABLE messages ADD COLUMN IF NOT EXISTS source text;
      CREATE INDEX IF NOT EXISTS messages_sender_outward_idx
        ON messages (sender_outward_account_id);
      CREATE INDEX IF NOT EXISTS messages_recipient_outward_idx
        ON messages (recipient_outward_account_id);
    `,
  },
  // Task #663: entity-scoped messaging. Sends are gated by the
  // application layer to require a non-null entity_id; the column is
  // nullable here so legacy DM rows can stay readable during the
  // burn-in window before the schema-level FK lands.
  {
    name: "messages.entity_id (#663)",
    sql: `
      ALTER TABLE messages ADD COLUMN IF NOT EXISTS entity_id integer;
      CREATE INDEX IF NOT EXISTS messages_entity_idx ON messages (entity_id);
    `,
  },

  // --- notifications -----------------------------------------------------
  {
    name: "notifications.outward_account_id",
    sql: `
      ALTER TABLE notifications ADD COLUMN IF NOT EXISTS outward_account_id integer;
      CREATE INDEX IF NOT EXISTS notifications_outward_account_idx
        ON notifications (outward_account_id);
      CREATE INDEX IF NOT EXISTS notifications_user_outward_idx
        ON notifications (user_clerk_id, outward_account_id);
    `,
  },

  // --- user_connections (replaces from_clerk_id / to_clerk_id) ----------
  {
    name: "user_connections outward columns",
    sql: `
      ALTER TABLE user_connections ADD COLUMN IF NOT EXISTS from_outward_account_id integer;
      ALTER TABLE user_connections ADD COLUMN IF NOT EXISTS to_outward_account_id integer;
      CREATE INDEX IF NOT EXISTS user_connections_from_outward_idx
        ON user_connections (from_outward_account_id);
      CREATE INDEX IF NOT EXISTS user_connections_to_outward_idx
        ON user_connections (to_outward_account_id);
    `,
  },
  // The schema's canonical uniqueness key is the outward-account pair —
  // the legacy `(from_clerk_id, to_clerk_id)` unique index is no longer
  // referenced. Without this index the connect endpoint's
  // `onConflictDoUpdate` against the outward pair fails with a 500.
  {
    name: "user_connections_outward_pair_unique",
    sql: `
      CREATE UNIQUE INDEX IF NOT EXISTS user_connections_outward_pair_unique
        ON user_connections (from_outward_account_id, to_outward_account_id);
    `,
  },
  // Task #501: unified team-up request foundation. Adds the columns
  // needed to carry a system-generated invite message + optional
  // personal note, plus the timestamps that record the request /
  // response / removal lifecycle.
  {
    name: "user_connections team-up columns (#501)",
    sql: `
      ALTER TABLE user_connections ADD COLUMN IF NOT EXISTS invite_message text;
      ALTER TABLE user_connections ADD COLUMN IF NOT EXISTS personal_note text;
      ALTER TABLE user_connections ADD COLUMN IF NOT EXISTS requested_at timestamptz;
      ALTER TABLE user_connections ADD COLUMN IF NOT EXISTS responded_at timestamptz;
      ALTER TABLE user_connections ADD COLUMN IF NOT EXISTS removed_at timestamptz;
      ALTER TABLE user_connections ADD COLUMN IF NOT EXISTS removed_by_outward_account_id integer;
    `,
  },

  // --- user_connections #504 cadence column ----------------------------
  // Hirer-controlled occasional / recurring sub-bucket. Defaults to
  // "occasional" so existing rows naturally land in the same bucket
  // they appeared in before this column existed.
  {
    name: "user_connections.cadence (#504)",
    sql: `
      ALTER TABLE user_connections
        ADD COLUMN IF NOT EXISTS cadence text DEFAULT 'occasional';
      UPDATE user_connections SET cadence = 'occasional' WHERE cadence IS NULL;
    `,
  },

  // --- app_invites (replaces from_clerk_id) -----------------------------
  {
    name: "app_invites outward columns",
    sql: `
      ALTER TABLE app_invites ADD COLUMN IF NOT EXISTS sender_outward_account_id integer;
      ALTER TABLE app_invites ADD COLUMN IF NOT EXISTS recipient_outward_account_id integer;
      CREATE INDEX IF NOT EXISTS app_invites_sender_outward_idx
        ON app_invites (sender_outward_account_id);
      CREATE INDEX IF NOT EXISTS app_invites_phone_idx
        ON app_invites (recipient_phone);
    `,
  },

  // --- app_invites.entity_id (#663) -----------------------------------
  {
    name: "app_invites.entity_id (#663)",
    sql: `
      ALTER TABLE app_invites ADD COLUMN IF NOT EXISTS entity_id integer;
      CREATE INDEX IF NOT EXISTS app_invites_entity_idx
        ON app_invites (entity_id);
    `,
  },

  // --- business_invites (replaces from_clerk_id) ------------------------
  {
    name: "business_invites outward columns",
    sql: `
      ALTER TABLE business_invites ADD COLUMN IF NOT EXISTS sender_outward_account_id integer;
      ALTER TABLE business_invites ADD COLUMN IF NOT EXISTS recipient_outward_account_id integer;
      CREATE INDEX IF NOT EXISTS business_invites_sender_outward_idx
        ON business_invites (sender_outward_account_id);
      CREATE INDEX IF NOT EXISTS business_invites_email_idx
        ON business_invites (email);
    `,
  },

  // --- team_seats --------------------------------------------------------
  {
    name: "team_seats table",
    sql: `
      CREATE TABLE IF NOT EXISTS team_seats (
        id serial PRIMARY KEY,
        company_outward_account_id integer NOT NULL,
        member_clerk_id text NOT NULL,
        role text NOT NULL DEFAULT 'employee',
        is_admin boolean NOT NULL DEFAULT false,
        permissions jsonb NOT NULL DEFAULT '{}'::jsonb,
        status text NOT NULL DEFAULT 'pending',
        invited_at timestamptz NOT NULL DEFAULT now(),
        accepted_at timestamptz,
        removed_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE UNIQUE INDEX IF NOT EXISTS team_seats_skin_member_unique
        ON team_seats (company_outward_account_id, member_clerk_id);
      CREATE INDEX IF NOT EXISTS team_seats_skin_idx
        ON team_seats (company_outward_account_id);
      CREATE INDEX IF NOT EXISTS team_seats_member_idx
        ON team_seats (member_clerk_id);
    `,
  },

  // --- user_team_members (legacy, used by team_seats backfill) ---------
  {
    name: "user_team_members table",
    sql: `
      CREATE TABLE IF NOT EXISTS user_team_members (
        id serial PRIMARY KEY,
        lead_clerk_id text NOT NULL,
        member_clerk_id text NOT NULL,
        role text NOT NULL,
        status text NOT NULL DEFAULT 'pending',
        invited_at timestamptz NOT NULL DEFAULT now(),
        accepted_at timestamptz
      );
      CREATE UNIQUE INDEX IF NOT EXISTS user_team_members_pair_unique
        ON user_team_members (lead_clerk_id, member_clerk_id);
      CREATE INDEX IF NOT EXISTS user_team_members_lead_idx
        ON user_team_members (lead_clerk_id);
      CREATE INDEX IF NOT EXISTS user_team_members_member_idx
        ON user_team_members (member_clerk_id);
    `,
  },
  {
    // #548 — admin-seeded teammate chip on the personal team.
    name: "user_team_members.chip + chip_other",
    sql: `
      ALTER TABLE user_team_members ADD COLUMN IF NOT EXISTS chip text;
      ALTER TABLE user_team_members ADD COLUMN IF NOT EXISTS chip_other text;
    `,
  },

  // --- outward_account_purge_runs --------------------------------------
  {
    name: "outward_account_purge_runs table",
    sql: `
      CREATE TABLE IF NOT EXISTS outward_account_purge_runs (
        id serial PRIMARY KEY,
        ran_at timestamptz NOT NULL DEFAULT now(),
        source text NOT NULL,
        accounts_removed integer NOT NULL DEFAULT 0,
        connections_removed integer NOT NULL DEFAULT 0,
        runs_trimmed integer NOT NULL DEFAULT 0,
        account_ids jsonb,
        connection_ids jsonb,
        duration_ms integer
      );
      CREATE INDEX IF NOT EXISTS outward_account_purge_runs_ran_at_idx
        ON outward_account_purge_runs (ran_at);
    `,
  },
  {
    name: "outward_account_purge_runs.runs_trimmed (legacy DBs)",
    sql: `ALTER TABLE outward_account_purge_runs ADD COLUMN IF NOT EXISTS runs_trimmed integer NOT NULL DEFAULT 0;`,
  },

  // --- reminders --------------------------------------------------------
  {
    name: "reminders table",
    sql: `
      CREATE TABLE IF NOT EXISTS reminders (
        id serial PRIMARY KEY,
        user_clerk_id text NOT NULL,
        title text NOT NULL,
        note text,
        due_at timestamptz NOT NULL,
        done boolean NOT NULL DEFAULT false,
        notified_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS reminders_user_idx ON reminders (user_clerk_id);
    `,
  },
  {
    name: "reminders.notified_at (legacy DBs)",
    sql: `ALTER TABLE reminders ADD COLUMN IF NOT EXISTS notified_at timestamptz;`,
  },
  {
    name: "reminders.notify_count (legacy DBs)",
    sql: `ALTER TABLE reminders ADD COLUMN IF NOT EXISTS notify_count integer NOT NULL DEFAULT 0;`,
  },

  // --- company_notices --------------------------------------------------
  {
    name: "company_notices table",
    sql: `
      CREATE TABLE IF NOT EXISTS company_notices (
        id serial PRIMARY KEY,
        company_outward_account_id integer NOT NULL,
        sender_clerk_id text NOT NULL,
        title text NOT NULL,
        body text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS company_notices_skin_idx
        ON company_notices (company_outward_account_id);
    `,
  },
  {
    name: "company_notice_acks table",
    sql: `
      CREATE TABLE IF NOT EXISTS company_notice_acks (
        id serial PRIMARY KEY,
        notice_id integer NOT NULL,
        member_clerk_id text NOT NULL,
        acknowledged_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE UNIQUE INDEX IF NOT EXISTS company_notice_acks_pair_unique
        ON company_notice_acks (notice_id, member_clerk_id);
      CREATE INDEX IF NOT EXISTS company_notice_acks_member_idx
        ON company_notice_acks (member_clerk_id);
    `,
  },

  // --- property_standards (creator outward account) --------------------
  {
    name: "property_standards.creator_outward_account_id",
    sql: `ALTER TABLE property_standards ADD COLUMN IF NOT EXISTS creator_outward_account_id integer;`,
  },

  // --- property_standard_evidence (creator outward account) ------------
  {
    name: "property_standard_evidence.creator_outward_account_id",
    sql: `ALTER TABLE property_standard_evidence ADD COLUMN IF NOT EXISTS creator_outward_account_id integer;`,
  },

  // --- recurring_tasks (creator + assignee outward account) ------------
  {
    name: "recurring_tasks outward columns",
    sql: `
      ALTER TABLE recurring_tasks ADD COLUMN IF NOT EXISTS assignee_outward_account_id integer;
      ALTER TABLE recurring_tasks ADD COLUMN IF NOT EXISTS creator_outward_account_id integer;
    `,
  },

  // --- property_assets (creator outward account) -----------------------
  {
    name: "property_assets.creator_outward_account_id",
    sql: `ALTER TABLE property_assets ADD COLUMN IF NOT EXISTS creator_outward_account_id integer;`,
  },

  // --- object_uploads (uploader outward account) -----------------------
  // Without this column, recordObjectUpload() (called from
  // POST /storage/uploads/request-url) crashes whenever the caller has an
  // active outward account, which silently breaks every photo upload —
  // most visibly the company logo on the profile.
  {
    name: "object_uploads.uploader_outward_account_id",
    sql: `
      ALTER TABLE object_uploads ADD COLUMN IF NOT EXISTS uploader_outward_account_id integer;
      CREATE INDEX IF NOT EXISTS object_uploads_outward_idx ON object_uploads (uploader_outward_account_id);
    `,
  },

  // --- work_logs (author outward account + acted_by) -------------------
  {
    name: "work_logs.author_outward_account_id",
    sql: `ALTER TABLE work_logs ADD COLUMN IF NOT EXISTS author_outward_account_id integer;`,
  },
  {
    name: "work_logs.acted_by_clerk_id",
    sql: `ALTER TABLE work_logs ADD COLUMN IF NOT EXISTS acted_by_clerk_id text;`,
  },
  {
    name: "work_logs.assignee_outward_account_id",
    sql: `ALTER TABLE work_logs ADD COLUMN IF NOT EXISTS assignee_outward_account_id integer;`,
  },
  {
    name: "work_logs.created_in_outward_account_id",
    sql: `ALTER TABLE work_logs ADD COLUMN IF NOT EXISTS created_in_outward_account_id integer;`,
  },

  // --- work_order_comment_reads (per-skin read state) ------------------
  {
    name: "work_order_comment_reads.outward_account_id",
    sql: `ALTER TABLE work_order_comment_reads ADD COLUMN IF NOT EXISTS outward_account_id integer;`,
  },

  // --- job_ratings (member + rated-by outward accounts) ---------------
  {
    name: "job_ratings outward columns",
    sql: `
      ALTER TABLE job_ratings ADD COLUMN IF NOT EXISTS member_outward_account_id integer;
      ALTER TABLE job_ratings ADD COLUMN IF NOT EXISTS rated_by_outward_account_id integer;
    `,
  },

  // --- property_notes / property_specs (author outward account) -------
  {
    name: "property_notes.author_outward_account_id",
    sql: `ALTER TABLE property_notes ADD COLUMN IF NOT EXISTS author_outward_account_id integer;`,
  },
  {
    name: "property_specs.author_outward_account_id",
    sql: `ALTER TABLE property_specs ADD COLUMN IF NOT EXISTS author_outward_account_id integer;`,
  },

  // --- work_order_comments (author outward account) --------------------
  {
    name: "work_order_comments.author_outward_account_id",
    sql: `ALTER TABLE work_order_comments ADD COLUMN IF NOT EXISTS author_outward_account_id integer;`,
  },

  // --- legacy NOT NULL relaxations -------------------------------------
  // The current schema no longer declares these legacy clerk-id columns,
  // but freshly-migrated dev DBs may still carry them with the original
  // NOT NULL constraint. Drop the constraint so inserts that only fill
  // the new outward-account columns (the way the schema does today)
  // succeed. The columns themselves are left in place so the
  // legacy-column backfill above can keep reading them on older DBs.
  {
    name: "user_connections.from_clerk_id NOT NULL → DROP",
    sql: `
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'user_connections' AND column_name = 'from_clerk_id'
            AND is_nullable = 'NO'
        ) THEN
          EXECUTE 'ALTER TABLE user_connections ALTER COLUMN from_clerk_id DROP NOT NULL';
        END IF;
      END $$;
    `,
  },
  {
    name: "user_connections.to_clerk_id NOT NULL → DROP",
    sql: `
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'user_connections' AND column_name = 'to_clerk_id'
            AND is_nullable = 'NO'
        ) THEN
          EXECUTE 'ALTER TABLE user_connections ALTER COLUMN to_clerk_id DROP NOT NULL';
        END IF;
      END $$;
    `,
  },
  {
    name: "app_invites.from_clerk_id NOT NULL → DROP",
    sql: `
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'app_invites' AND column_name = 'from_clerk_id'
            AND is_nullable = 'NO'
        ) THEN
          EXECUTE 'ALTER TABLE app_invites ALTER COLUMN from_clerk_id DROP NOT NULL';
        END IF;
      END $$;
    `,
  },
  {
    name: "business_invites.from_clerk_id NOT NULL → DROP",
    sql: `
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'business_invites' AND column_name = 'from_clerk_id'
            AND is_nullable = 'NO'
        ) THEN
          EXECUTE 'ALTER TABLE business_invites ALTER COLUMN from_clerk_id DROP NOT NULL';
        END IF;
      END $$;
    `,
  },

  // --- users address fields for prize fulfillment ----------------------
  {
    name: "users.address_street",
    sql: `ALTER TABLE users ADD COLUMN IF NOT EXISTS address_street text;`,
  },
  {
    name: "users.address_city",
    sql: `ALTER TABLE users ADD COLUMN IF NOT EXISTS address_city text;`,
  },
  {
    name: "users.address_state",
    sql: `ALTER TABLE users ADD COLUMN IF NOT EXISTS address_state text;`,
  },

  // --- point_settings ---------------------------------------------------
  {
    name: "point_settings table",
    sql: `
      CREATE TABLE IF NOT EXISTS point_settings (
        event_type text PRIMARY KEY,
        points integer NOT NULL,
        label text NOT NULL DEFAULT '',
        description text NOT NULL DEFAULT '',
        updated_at timestamptz NOT NULL DEFAULT now()
      );
    `,
  },

  // --- concierge --------------------------------------------------------
  {
    name: "concierge_conversations table",
    sql: `
      CREATE TABLE IF NOT EXISTS concierge_conversations (
        id serial PRIMARY KEY,
        user_clerk_id text NOT NULL,
        outward_account_id integer NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS concierge_conversations_user_acct_idx
        ON concierge_conversations (user_clerk_id, outward_account_id);
    `,
  },
  {
    // Tighten the (user, outward account) pair to be unique. Older
    // dev DBs may already have created duplicate threads via the
    // pre-unique index, so we collapse them to the lowest id first
    // (the SELECT inside the DELETE finds dupes; the trick is safe to
    // re-run because the second pass simply finds none).
    name: "concierge_conversations_user_acct_unique",
    sql: `
      DELETE FROM concierge_conversations a
      USING concierge_conversations b
      WHERE a.id > b.id
        AND a.user_clerk_id = b.user_clerk_id
        AND a.outward_account_id = b.outward_account_id;
      CREATE UNIQUE INDEX IF NOT EXISTS concierge_conversations_user_acct_unique
        ON concierge_conversations (user_clerk_id, outward_account_id);
    `,
  },
  {
    name: "concierge_usage_events table",
    sql: `
      CREATE TABLE IF NOT EXISTS concierge_usage_events (
        id serial PRIMARY KEY,
        user_clerk_id text NOT NULL,
        outward_account_id integer NOT NULL,
        kind text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS concierge_usage_user_kind_created_idx
        ON concierge_usage_events (user_clerk_id, kind, created_at);
    `,
  },
  {
    name: "concierge_messages table",
    sql: `
      CREATE TABLE IF NOT EXISTS concierge_messages (
        id serial PRIMARY KEY,
        conversation_id integer NOT NULL,
        role text NOT NULL,
        content text NOT NULL DEFAULT '',
        proposed_actions jsonb,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS concierge_messages_conv_idx
        ON concierge_messages (conversation_id, created_at);
    `,
  },

  // --- prize_winners ----------------------------------------------------
  {
    name: "prize_winners table",
    sql: `
      CREATE TABLE IF NOT EXISTS prize_winners (
        id serial PRIMARY KEY,
        user_clerk_id text NOT NULL,
        prize_key text NOT NULL DEFAULT 'monthly',
        status text NOT NULL DEFAULT 'selected',
        notes text,
        selected_at timestamptz NOT NULL DEFAULT now(),
        shipped_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS prize_winners_user_idx ON prize_winners (user_clerk_id);
    `,
  },

  // --- preset_chips / preset_groups ------------------------------------
  // Admin-editable chip/token sets used as profile chips and labels
  // across the app. See lib/db/src/schema/preset_chips.ts.
  {
    name: "preset_chips table",
    sql: `
      CREATE TABLE IF NOT EXISTS preset_chips (
        id serial PRIMARY KEY,
        set_key text NOT NULL,
        chip_id text NOT NULL,
        label text NOT NULL,
        sublabel text,
        group_key text,
        sort_order integer NOT NULL DEFAULT 0,
        archived_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE UNIQUE INDEX IF NOT EXISTS preset_chips_set_chip_unique
        ON preset_chips (set_key, chip_id);
      CREATE INDEX IF NOT EXISTS preset_chips_set_idx
        ON preset_chips (set_key);
    `,
  },
  {
    name: "preset_groups table",
    sql: `
      CREATE TABLE IF NOT EXISTS preset_groups (
        id serial PRIMARY KEY,
        set_key text NOT NULL,
        group_key text NOT NULL,
        label text NOT NULL,
        sort_order integer NOT NULL DEFAULT 0,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE UNIQUE INDEX IF NOT EXISTS preset_groups_set_group_unique
        ON preset_groups (set_key, group_key);
    `,
  },

  // --- admin_demo_profiles --------------------------------------------
  // Stores the Firebase password used at provision time so the Hub
  // can recover an EMAIL_EXISTS Firebase orphan via signInWithPassword.
  // Nullable — pre-existing rows don't have one stored.
  {
    name: "admin_demo_profiles.demo_password",
    sql: `ALTER TABLE admin_demo_profiles ADD COLUMN IF NOT EXISTS demo_password text;`,
  },

  // Task #677: denormalized `users.is_demo` mirror of the
  // `admin_demo_profiles` row (keyed on demo_clerk_id). Public
  // discovery filters used to do a per-row `NOT EXISTS` subquery
  // against `admin_demo_profiles`; they now read this boolean
  // directly (column predicate when users is already joined; small
  // `NOT EXISTS` against the partial index below when keying on a
  // foreign clerk id like `work_logs.assignee_clerk_id`). Backfill
  // sets `is_demo = true` for every user whose clerk id appears in
  // `admin_demo_profiles` so existing rows match the new write path
  // before any read switches over. The partial index is intentionally
  // tiny — only the demo rows live in it — so the foreign-id
  // `NOT EXISTS` stays cheap as the user table grows.
  {
    name: "users.is_demo",
    sql: `ALTER TABLE users ADD COLUMN IF NOT EXISTS is_demo boolean NOT NULL DEFAULT false;`,
  },
  {
    name: "users.is_demo backfill from admin_demo_profiles",
    sql: `
      UPDATE users
        SET is_demo = true
        WHERE is_demo = false
          AND clerk_id IN (SELECT demo_clerk_id FROM admin_demo_profiles);
    `,
  },
  {
    name: "users_is_demo_partial_idx",
    sql: `
      CREATE INDEX IF NOT EXISTS users_is_demo_partial_idx
        ON users (clerk_id)
        WHERE is_demo = true;
    `,
  },

  // --- daily_login_awards ----------------------------------------------
  {
    name: "daily_login_awards table",
    sql: `
      CREATE TABLE IF NOT EXISTS daily_login_awards (
        id serial PRIMARY KEY,
        user_clerk_id text NOT NULL,
        local_date text NOT NULL,
        local_hour text NOT NULL,
        points text NOT NULL DEFAULT '0',
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE UNIQUE INDEX IF NOT EXISTS daily_login_user_date_unique
        ON daily_login_awards (user_clerk_id, local_date);
      CREATE INDEX IF NOT EXISTS daily_login_user_date_idx
        ON daily_login_awards (user_clerk_id, local_date);
    `,
  },

  // --- subscriptions ----------------------------------------------------
  {
    name: "subscriptions table",
    sql: `
      CREATE TABLE IF NOT EXISTS subscriptions (
        id serial PRIMARY KEY,
        outward_account_id integer NOT NULL,
        payer_clerk_id text NOT NULL,
        status text NOT NULL,
        processor_customer_id text,
        processor_subscription_id text,
        current_period_end timestamptz,
        price_cents integer NOT NULL DEFAULT 0,
        currency text NOT NULL DEFAULT 'USD',
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_outward_account_idx
        ON subscriptions (outward_account_id);
      CREATE INDEX IF NOT EXISTS subscriptions_payer_idx
        ON subscriptions (payer_clerk_id);
    `,
  },
];

async function syncSchema(): Promise<void> {
  for (const step of SCHEMA_STEPS) {
    process.stdout.write(`  · ${step.name} … `);
    await pool.query(step.sql);
    process.stdout.write("ok\n");
  }
}

/**
 * Backfill the new `*_outward_account_id` columns on tables that
 * previously keyed on a clerk id. Each row is matched to that user's
 * lowest-id outward account (the "default skin" the migration seeded).
 *
 * Each step first checks that both the legacy source column and the new
 * target column exist on the table — so the function is a no-op on
 * environments where the legacy columns have already been dropped (e.g.
 * a DB created from the current schema, or a DB that already ran the
 * follow-up cleanup).
 */
async function columnExists(table: string, column: string): Promise<boolean> {
  const r = await pool.query(
    `SELECT 1
       FROM information_schema.columns
      WHERE table_name = $1 AND column_name = $2
      LIMIT 1`,
    [table, column],
  );
  return (r.rowCount ?? 0) > 0;
}

async function backfillLegacyClerkIdColumns(): Promise<{
  userConnections: number | "skipped";
  appInvites: number | "skipped";
  businessInvites: number | "skipped";
}> {
  // user_connections: from_clerk_id → from_outward_account_id,
  // to_clerk_id → to_outward_account_id
  let userConnections: number | "skipped" = "skipped";
  if (
    (await columnExists("user_connections", "from_clerk_id")) &&
    (await columnExists("user_connections", "to_clerk_id")) &&
    (await columnExists("user_connections", "from_outward_account_id")) &&
    (await columnExists("user_connections", "to_outward_account_id"))
  ) {
    const r = await pool.query(`
      WITH defaults AS (
        SELECT owner_clerk_id, MIN(id) AS account_id
        FROM outward_accounts
        WHERE archived_at IS NULL
        GROUP BY owner_clerk_id
      )
      UPDATE user_connections uc
      SET from_outward_account_id = COALESCE(uc.from_outward_account_id, df.account_id),
          to_outward_account_id   = COALESCE(uc.to_outward_account_id, dt.account_id)
      FROM defaults df, defaults dt
      WHERE df.owner_clerk_id = uc.from_clerk_id
        AND dt.owner_clerk_id = uc.to_clerk_id
        AND (uc.from_outward_account_id IS NULL OR uc.to_outward_account_id IS NULL);
    `);
    userConnections = r.rowCount ?? 0;
  }

  // app_invites: from_clerk_id → sender_outward_account_id
  let appInvites: number | "skipped" = "skipped";
  if (
    (await columnExists("app_invites", "from_clerk_id")) &&
    (await columnExists("app_invites", "sender_outward_account_id"))
  ) {
    const r = await pool.query(`
      WITH defaults AS (
        SELECT owner_clerk_id, MIN(id) AS account_id
        FROM outward_accounts
        WHERE archived_at IS NULL
        GROUP BY owner_clerk_id
      )
      UPDATE app_invites ai
      SET sender_outward_account_id = d.account_id
      FROM defaults d
      WHERE d.owner_clerk_id = ai.from_clerk_id
        AND ai.sender_outward_account_id IS NULL;
    `);
    appInvites = r.rowCount ?? 0;
  }

  // business_invites: from_clerk_id → sender_outward_account_id
  let businessInvites: number | "skipped" = "skipped";
  if (
    (await columnExists("business_invites", "from_clerk_id")) &&
    (await columnExists("business_invites", "sender_outward_account_id"))
  ) {
    const r = await pool.query(`
      WITH defaults AS (
        SELECT owner_clerk_id, MIN(id) AS account_id
        FROM outward_accounts
        WHERE archived_at IS NULL
        GROUP BY owner_clerk_id
      )
      UPDATE business_invites bi
      SET sender_outward_account_id = d.account_id
      FROM defaults d
      WHERE d.owner_clerk_id = bi.from_clerk_id
        AND bi.sender_outward_account_id IS NULL;
    `);
    businessInvites = r.rowCount ?? 0;
  }

  return { userConnections, appInvites, businessInvites };
}

/**
 * Tighten NOT NULL constraints on columns the schema declares as
 * `.notNull()` but were added nullable to keep this migration
 * non-destructive. We only flip the constraint when no NULL rows remain
 * — otherwise we leave the column nullable and surface a warning so the
 * operator can investigate.
 */
async function enforceNotNullConstraints(): Promise<{ unresolved: string[] }> {
  const constraints: { table: string; column: string }[] = [
    { table: "user_connections", column: "from_outward_account_id" },
    { table: "user_connections", column: "to_outward_account_id" },
    { table: "app_invites", column: "sender_outward_account_id" },
    { table: "business_invites", column: "sender_outward_account_id" },
  ];

  const unresolved: string[] = [];
  for (const { table, column } of constraints) {
    const nullCount = await pool.query(
      `SELECT COUNT(*)::int AS n FROM ${table} WHERE ${column} IS NULL`,
    );
    const n = nullCount.rows[0]?.n ?? 0;
    if (n > 0) {
      console.warn(
        `  ! ${table}.${column}: ${n} row(s) still NULL — leaving column nullable.\n` +
          `    Remediation: backfill those rows (typically by mapping their legacy\n` +
          `    clerk_id to an outward_accounts row, or by deleting the orphaned rows)\n` +
          `    and re-run \`pnpm --filter @workspace/db migrate\`.`,
      );
      unresolved.push(`${table}.${column} (${n} null row${n === 1 ? "" : "s"})`);
      continue;
    }
    // Wrap in a check so re-running is a no-op.
    await pool.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = '${table}' AND column_name = '${column}'
            AND is_nullable = 'YES'
        ) THEN
          EXECUTE 'ALTER TABLE ${table} ALTER COLUMN ${column} SET NOT NULL';
        END IF;
      END $$;
    `);
    process.stdout.write(`  · ${table}.${column} → NOT NULL\n`);
  }
  return { unresolved };
}

export interface MigrateResult {
  /**
   * Columns the schema declares as `.notNull()` that were left nullable
   * because backfill rows were still missing. Empty array means every
   * required NOT NULL constraint is in place.
   */
  unresolved: string[];
  /** Wall-clock time the migration step took, in milliseconds. */
  durationMs: number;
  /** ISO-8601 timestamp the migration finished. */
  completedAt: string;
}

export async function migrate(): Promise<MigrateResult> {
  const startedAt = Date.now();

  console.log("[migrate] 1/5 syncing schema (idempotent DDL)");
  await syncSchema();

  console.log("[migrate] 2/5 seeding outward accounts + owner backfill");
  const outward = await migrateOutwardAccounts();
  console.log(`        ${JSON.stringify(outward)}`);

  console.log("[migrate] 3/5 backfilling legacy clerk_id → outward_account_id");
  const legacy = await backfillLegacyClerkIdColumns();
  console.log(`        ${JSON.stringify(legacy)}`);

  console.log("[migrate] 4/5 seeding team_seats");
  const seats = await migrateTeamSeats();
  console.log(`        ${JSON.stringify(seats)}`);

  // Task #546: legacy work_order_comments rows can have a NULL
  // author_outward_account_id, which makes the per-client tag (#537)
  // resolve against the wrong skin. Stamp the author's default
  // outward account on those rows so the GET handler doesn't need a
  // fallback branch.
  console.log("[migrate] 4.5/5 backfilling work_order_comments author skin");
  const commentSkin = await backfillCommentAuthorOutwardAccount();
  console.log(`        ${JSON.stringify(commentSkin)}`);

  console.log("[migrate] 5/5 enforcing NOT NULL where rows are filled");
  const { unresolved } = await enforceNotNullConstraints();

  const durationMs = Date.now() - startedAt;
  const completedAt = new Date().toISOString();

  if (unresolved.length > 0) {
    console.log(
      `[migrate] done with warnings — ${unresolved.length} column(s) left nullable: ${unresolved.join(", ")}`,
    );
  } else {
    console.log("[migrate] done");
  }

  return { unresolved, durationMs, completedAt };
}

const isDirectRun =
  typeof process !== "undefined" &&
  process.argv[1] &&
  (process.argv[1].endsWith("migrate.ts") || process.argv[1].endsWith("migrate.js"));

if (isDirectRun) {
  migrate()
    .then(({ unresolved }) => {
      // Preserve the historical contract that running this script
      // directly exits with code 2 when required NOT NULL columns
      // were left nullable due to unresolved NULL rows. Deploy
      // tooling and CI rely on the non-zero status to surface the
      // degraded-schema state.
      const code = unresolved.length > 0 ? 2 : 0;
      return pool.end().then(() => process.exit(code));
    })
    .catch((err) => {
      // eslint-disable-next-line no-console
      console.error("[migrate] failed", err);
      pool.end().finally(() => process.exit(1));
    });
}
