import OpenAI from "openai";
import { and, asc, desc, eq, gte, inArray, sql } from "drizzle-orm";
import {
  db,
  conciergeConversationsTable,
  conciergeMessagesTable,
  conciergeUsageEventsTable,
  workLogsTable,
  workOrdersTable,
  remindersTable,
  outwardAccountsTable,
  propertiesTable,
  type ConciergeConversation,
  type ConciergeMessage,
} from "@workspace/db";

/**
 * Server-side AI concierge. Wraps the OpenAI SDK against the Replit AI
 * Integrations proxy so we never need a customer-supplied API key.
 *
 * The concierge only ever proposes structured actions — it never writes
 * data on the user's behalf. The mobile client renders each action as a
 * "Confirm / Edit / Dismiss" card and, on Confirm, calls the existing
 * REST endpoints (POST /reminders, POST /properties/:id/work-logs, etc.)
 * itself. That keeps every paid action gated by the same capability
 * checks the rest of the API already enforces.
 */

const OPENAI_BASE_URL = process.env["AI_INTEGRATIONS_OPENAI_BASE_URL"];
const OPENAI_API_KEY = process.env["AI_INTEGRATIONS_OPENAI_API_KEY"];

let cached: OpenAI | null = null;
function client(): OpenAI {
  if (!OPENAI_BASE_URL || !OPENAI_API_KEY) {
    throw new Error(
      "OpenAI integration is not configured. Set AI_INTEGRATIONS_OPENAI_BASE_URL and AI_INTEGRATIONS_OPENAI_API_KEY.",
    );
  }
  if (!cached) {
    cached = new OpenAI({ baseURL: OPENAI_BASE_URL, apiKey: OPENAI_API_KEY });
  }
  return cached;
}

export function conciergeEnabled(): boolean {
  return Boolean(OPENAI_BASE_URL && OPENAI_API_KEY);
}

export interface ConciergeContext {
  accountTitle: string;
  accountKind: string;
  recentLogs: Array<{ id: number; note: string | null; propertyName: string | null; createdAt: string }>;
  openWorkOrders: Array<{
    id: number;
    title: string;
    propertyName: string | null;
    status: string;
    updatedAt: string;
  }>;
  upcomingReminders: Array<{ id: number; title: string; dueAt: string }>;
  idleJobs: Array<{ id: number; title: string; daysIdle: number; propertyName: string | null }>;
  /**
   * Properties owned by the active outward account. Capped to keep the
   * prompt small; the assistant uses these to refer to places by their
   * nickname instead of saying "your property".
   */
  properties: Array<{ id: number; name: string; address: string | null }>;
  /**
   * Accepted client connections of the active outward account. Capped
   * for the same reason as `properties`. `displayName` is the best
   * human-readable label we have for the connected outward account.
   */
  clients: Array<{
    connectionId: number;
    outwardAccountId: number;
    displayName: string;
    serviceTitle: string | null;
    /**
     * 1–2 most recent message snippets exchanged with this client,
     * newest first. `fromUser` is true when the active user sent it.
     */
    recentMessages: Array<{
      snippet: string;
      fromUser: boolean;
      at: string;
    }>;
    /**
     * 1–2 most recently-touched work orders the client filed,
     * newest-updated first.
     */
    recentWorkOrders: Array<{
      id: number;
      title: string;
      updatedAt: string;
    }>;
  }>;
}

/** Caps on per-list context size, kept in one place so they're easy to tune. */
const CONTEXT_LIMITS = {
  properties: 25,
  clients: 25,
  /** Per-client snippet caps — kept tight to bound prompt token usage. */
  messagesPerClient: 2,
  workOrdersPerClient: 2,
  snippetChars: 80,
} as const;

/** Pull a small, fresh snapshot of the user's working state for prompting. */
export async function loadConciergeContext(
  userClerkId: string,
  outwardAccountId: number,
): Promise<ConciergeContext> {
  const [acct] = await db
    .select({
      title: outwardAccountsTable.title,
      displayName: outwardAccountsTable.displayName,
      companyName: outwardAccountsTable.companyName,
      kind: outwardAccountsTable.kind,
    })
    .from(outwardAccountsTable)
    .where(eq(outwardAccountsTable.id, outwardAccountId));

  const since = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);

  const recentLogs = await db
    .select({
      id: workLogsTable.id,
      note: workLogsTable.note,
      createdAt: workLogsTable.createdAt,
      propertyId: workLogsTable.propertyId,
    })
    .from(workLogsTable)
    .where(
      and(
        eq(workLogsTable.authorOutwardAccountId, outwardAccountId),
        gte(workLogsTable.createdAt, since),
      ),
    )
    .orderBy(desc(workLogsTable.createdAt))
    .limit(10);

  const openWorkOrders = await db
    .select({
      id: workOrdersTable.id,
      title: workOrdersTable.title,
      status: workOrdersTable.status,
      updatedAt: workOrdersTable.updatedAt,
      propertyId: workOrdersTable.propertyId,
    })
    .from(workOrdersTable)
    .where(
      and(
        eq(workOrdersTable.createdByOutwardAccountId, outwardAccountId),
        sql`${workOrdersTable.status} <> 'closed'`,
      ),
    )
    .orderBy(desc(workOrdersTable.updatedAt))
    .limit(8);

  const upcomingReminders = await db
    .select({
      id: remindersTable.id,
      title: remindersTable.title,
      dueAt: remindersTable.dueAt,
    })
    .from(remindersTable)
    .where(
      and(
        eq(remindersTable.userClerkId, userClerkId),
        eq(remindersTable.done, false),
      ),
    )
    .orderBy(asc(remindersTable.dueAt))
    .limit(5);

  // Properties owned by the active outward account. Used both as
  // first-class context and as a lookup table to backfill the
  // `propertyName` fields on logs / work orders below.
  const properties = await db
    .select({
      id: propertiesTable.id,
      name: propertiesTable.name,
      address: propertiesTable.address,
    })
    .from(propertiesTable)
    .where(eq(propertiesTable.ownerOutwardAccountId, outwardAccountId))
    .orderBy(desc(propertiesTable.updatedAt))
    .limit(CONTEXT_LIMITS.properties);

  // Task #663: the concierge's "your accepted client connections"
  // context dimension was sourced from `user_connections.kind=client`,
  // which has been retired. Until the equivalent surface ("avatars I
  // share entities with where they're tagged as a client") is
  // reintroduced as part of the T007 entity UI, we feed the prompt an
  // empty client list so the model still has the rest of the context
  // (properties, work orders, reminders, idle jobs) to reason over.
  const clientRows: Array<{
    connectionId: number;
    outwardAccountId: number;
    title: string | null;
    displayName: string | null;
    companyName: string | null;
    serviceTitle: string | null;
  }> = [];

  // For each connected client, pull a tiny window of recent messages
  // and recent work-order titles so the assistant can talk about what
  // the client most recently asked for instead of just naming them.
  // Single batched query per source, grouped in JS, capped per client.
  const clientIds = clientRows.map((c) => c.outwardAccountId);
  const messagesByClient = new Map<
    number,
    Array<{ snippet: string; fromUser: boolean; at: Date }>
  >();
  const workOrdersByClient = new Map<
    number,
    Array<{ id: number; title: string; updatedAt: Date }>
  >();
  if (clientIds.length > 0) {
    // Per-client top-N retrieval via window functions so one chatty
    // client can't starve quieter clients out of the snapshot.
    const messagesPerClient = CONTEXT_LIMITS.messagesPerClient;
    const workOrdersPerClient = CONTEXT_LIMITS.workOrdersPerClient;

    const messageRows = await db.execute<{
      id: number;
      content: string;
      created_at: Date;
      other_id: number;
      from_user: boolean;
    }>(sql`
      WITH dm AS (
        SELECT
          id,
          content,
          created_at,
          CASE WHEN sender_outward_account_id = ${outwardAccountId}
               THEN recipient_outward_account_id
               ELSE sender_outward_account_id
          END AS other_id,
          (sender_outward_account_id = ${outwardAccountId}) AS from_user
        FROM messages
        WHERE (
                sender_outward_account_id = ${outwardAccountId}
                AND recipient_outward_account_id = ANY(${clientIds})
              )
           OR (
                recipient_outward_account_id = ${outwardAccountId}
                AND sender_outward_account_id = ANY(${clientIds})
              )
      ),
      ranked AS (
        SELECT id, content, created_at, other_id, from_user,
               row_number() OVER (PARTITION BY other_id ORDER BY created_at DESC) AS rn
        FROM dm
      )
      SELECT id, content, created_at, other_id, from_user
      FROM ranked
      WHERE rn <= ${messagesPerClient}
    `);
    for (const m of messageRows.rows) {
      const otherId = Number(m.other_id);
      if (!Number.isFinite(otherId)) continue;
      const trimmed = (m.content ?? "").trim();
      if (!trimmed) continue;
      const snippet =
        trimmed.length > CONTEXT_LIMITS.snippetChars
          ? trimmed.slice(0, CONTEXT_LIMITS.snippetChars - 1) + "…"
          : trimmed;
      const bucket = messagesByClient.get(otherId) ?? [];
      bucket.push({
        snippet,
        fromUser: Boolean(m.from_user),
        at: new Date(m.created_at),
      });
      messagesByClient.set(otherId, bucket);
    }
    // Defensive sort + cap; the window query already enforces both,
    // but this keeps the in-memory shape predictable if rows arrive in
    // any order.
    for (const [k, list] of messagesByClient) {
      list.sort((a, b) => +b.at - +a.at);
      messagesByClient.set(k, list.slice(0, messagesPerClient));
    }

    const woRows = await db.execute<{
      id: number;
      title: string;
      updated_at: Date;
      created_by_outward_account_id: number;
    }>(sql`
      SELECT id, title, updated_at, created_by_outward_account_id
      FROM (
        SELECT id, title, updated_at, created_by_outward_account_id,
               row_number() OVER (
                 PARTITION BY created_by_outward_account_id
                 ORDER BY updated_at DESC
               ) AS rn
        FROM work_orders
        -- Scope: the client filed it AND this user is the assignee.
        -- Without the assignee constraint we'd leak titles from the
        -- client's unrelated jobs with other providers into the prompt.
        WHERE created_by_outward_account_id = ANY(${clientIds})
          AND assignee_outward_account_id = ${outwardAccountId}
      ) t
      WHERE rn <= ${workOrdersPerClient}
    `);
    for (const wo of woRows.rows) {
      const cid = Number(wo.created_by_outward_account_id);
      if (!Number.isFinite(cid)) continue;
      const bucket = workOrdersByClient.get(cid) ?? [];
      bucket.push({
        id: Number(wo.id),
        title: wo.title,
        updatedAt: new Date(wo.updated_at),
      });
      workOrdersByClient.set(cid, bucket);
    }
    for (const [k, list] of workOrdersByClient) {
      list.sort((a, b) => +b.updatedAt - +a.updatedAt);
      workOrdersByClient.set(k, list.slice(0, workOrdersPerClient));
    }
  }

  // Build a propertyId → name map covering any property referenced by
  // the lists we already loaded, even if it lives outside the capped
  // `properties` list above (e.g. a log on a property the user no
  // longer owns directly).
  const referencedPropertyIds = new Set<number>();
  for (const l of recentLogs) referencedPropertyIds.add(l.propertyId);
  for (const wo of openWorkOrders) referencedPropertyIds.add(wo.propertyId);
  for (const p of properties) referencedPropertyIds.add(p.id);
  const propertyNameById = new Map<number, string>();
  if (referencedPropertyIds.size > 0) {
    const rows = await db
      .select({ id: propertiesTable.id, name: propertiesTable.name })
      .from(propertiesTable)
      .where(inArray(propertiesTable.id, Array.from(referencedPropertyIds)));
    for (const r of rows) propertyNameById.set(r.id, r.name);
  }

  // "Idle jobs" = open work orders that haven't moved in 5+ days. Stays
  // in JS so we don't need a second DB roundtrip.
  const fiveDaysAgo = Date.now() - 5 * 24 * 60 * 60 * 1000;
  const idleJobs = openWorkOrders
    .filter((wo) => +new Date(wo.updatedAt) <= fiveDaysAgo)
    .map((wo) => ({
      id: wo.id,
      title: wo.title,
      daysIdle: Math.floor((Date.now() - +new Date(wo.updatedAt)) / 86_400_000),
      propertyName: propertyNameById.get(wo.propertyId) ?? null,
    }));

  return {
    accountTitle: acct?.title || acct?.displayName || acct?.companyName || "your account",
    accountKind: acct?.kind ?? "home",
    recentLogs: recentLogs.map((l) => ({
      id: l.id,
      note: l.note,
      propertyName: propertyNameById.get(l.propertyId) ?? null,
      createdAt: l.createdAt.toISOString(),
    })),
    openWorkOrders: openWorkOrders.map((wo) => ({
      id: wo.id,
      title: wo.title,
      propertyName: propertyNameById.get(wo.propertyId) ?? null,
      status: wo.status,
      updatedAt: wo.updatedAt.toISOString(),
    })),
    upcomingReminders: upcomingReminders.map((r) => ({
      id: r.id,
      title: r.title,
      dueAt: r.dueAt.toISOString(),
    })),
    idleJobs,
    properties: properties.map((p) => ({
      id: p.id,
      name: p.name,
      address: p.address?.trim() ? p.address : null,
    })),
    clients: clientRows.map((c) => ({
      connectionId: c.connectionId,
      outwardAccountId: c.outwardAccountId,
      displayName:
        c.title?.trim() ||
        c.displayName?.trim() ||
        c.companyName?.trim() ||
        `Client #${c.outwardAccountId}`,
      serviceTitle: c.serviceTitle ?? null,
      recentMessages: (messagesByClient.get(c.outwardAccountId) ?? []).map(
        (m) => ({ snippet: m.snippet, fromUser: m.fromUser, at: m.at.toISOString() }),
      ),
      recentWorkOrders: (workOrdersByClient.get(c.outwardAccountId) ?? []).map(
        (w) => ({ id: w.id, title: w.title, updatedAt: w.updatedAt.toISOString() }),
      ),
    })),
  };
}

export interface ProposedAction {
  type:
    | "draft_client_note"
    | "create_reminder"
    | "log_work_item"
    | "open_job"
    | "pep_talk";
  /** Human-readable label the client renders on the Confirm card. */
  label: string;
  /** Free-form payload the client uses when the user confirms. */
  payload: Record<string, unknown>;
}

const SYSTEM_PROMPT = `You are the Roundhouse Concierge: a calm, encouraging assistant
embedded inside the Roundhouse mobile app's timeline. You help trade
pros and homeowners keep momentum on their work. You never write data
yourself — you propose actions the user must confirm.

When the user asks for something that maps to one of your tools, call
the tool and produce a short reply that introduces the proposal. When
nothing actionable is needed, reply briefly and warmly. Keep replies
under 80 words.

The supplied context lists the user's properties (with their nicknames
and addresses) and their connected clients (with display names). Each
client may also include a couple of their most recent message snippets
and the titles of work orders they recently filed — use these to make
follow-ups concrete (e.g. "Reply to Dana about the leaking faucet")
instead of generic. Refer to entities by name when it helps, but never
invent properties, jobs, snippets, or clients that aren't in the
context. If the right entity isn't listed, keep the reference generic
instead.`;

const TOOLS: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "draft_client_note",
      description: "Draft a short follow-up message the user can send to a client.",
      parameters: {
        type: "object",
        properties: {
          recipientName: { type: "string", description: "Display name of the client." },
          subject: { type: "string", description: "What the message is about." },
          draft: { type: "string", description: "The drafted message body." },
        },
        required: ["draft"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_reminder",
      description: "Propose a reminder for the user.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string" },
          note: { type: "string" },
          dueAt: { type: "string", description: "ISO 8601 timestamp." },
        },
        required: ["title", "dueAt"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "log_work_item",
      description: "Propose a work-log entry for a property.",
      parameters: {
        type: "object",
        properties: {
          propertyId: { type: "number" },
          note: { type: "string" },
        },
        required: ["note"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "open_job",
      description: "Open a specific work order in the app for the user.",
      parameters: {
        type: "object",
        properties: { workOrderId: { type: "number" } },
        required: ["workOrderId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "pep_talk",
      description: "Send the user a short pep talk celebrating recent progress.",
      parameters: {
        type: "object",
        properties: { message: { type: "string" } },
        required: ["message"],
      },
    },
  },
];

function actionFromToolCall(
  name: string,
  args: Record<string, unknown>,
): ProposedAction | null {
  switch (name) {
    case "draft_client_note":
      return {
        type: "draft_client_note",
        label: `Draft: ${String(args.subject ?? "Follow-up note").slice(0, 60)}`,
        payload: args,
      };
    case "create_reminder":
      return {
        type: "create_reminder",
        label: `Reminder: ${String(args.title ?? "New reminder").slice(0, 60)}`,
        payload: args,
      };
    case "log_work_item":
      return {
        type: "log_work_item",
        label: `Log work: ${String(args.note ?? "").slice(0, 60)}`,
        payload: args,
      };
    case "open_job":
      return {
        type: "open_job",
        label: `Open job #${args.workOrderId ?? ""}`,
        payload: args,
      };
    case "pep_talk":
      return {
        type: "pep_talk",
        label: "A quick pep talk",
        payload: args,
      };
    default:
      return null;
  }
}

export interface ConciergeReply {
  content: string;
  proposedActions: ProposedAction[];
}

function buildContextSystemMessage(ctx: ConciergeContext): string {
  const propertyLine = ctx.properties.length
    ? ctx.properties
        .map((p) => `#${p.id} ${p.name}${p.address ? ` (${p.address})` : ""}`)
        .join(" | ")
    : "none";
  const clientLine = ctx.clients.length
    ? ctx.clients
        .map((c) => {
          const head = `${c.displayName}${c.serviceTitle ? ` — ${c.serviceTitle}` : ""}`;
          const woBit = c.recentWorkOrders.length
            ? ` recent jobs: ${c.recentWorkOrders.map((w) => `#${w.id} ${w.title}`).join("; ")}`
            : "";
          const msgBit = c.recentMessages.length
            ? ` recent msgs: ${c.recentMessages
                .map((m) => `${m.fromUser ? "you" : "them"}: "${m.snippet}"`)
                .join(" / ")}`
            : "";
          return `${head}${woBit}${msgBit}`;
        })
        .join(" | ")
    : "none";
  return [
    `Account: ${ctx.accountTitle} (${ctx.accountKind}).`,
    `Properties: ${propertyLine}.`,
    `Clients: ${clientLine}.`,
    `Recent logs (last 14d): ${ctx.recentLogs.length ? ctx.recentLogs.map((l) => `#${l.id}${l.propertyName ? ` @ ${l.propertyName}` : ""} ${l.note ?? ""}`.trim()).join(" | ") : "none"}.`,
    `Open work orders: ${ctx.openWorkOrders.length ? ctx.openWorkOrders.map((w) => `#${w.id} ${w.title}${w.propertyName ? ` @ ${w.propertyName}` : ""} (${w.status})`).join(" | ") : "none"}.`,
    `Upcoming reminders: ${ctx.upcomingReminders.length ? ctx.upcomingReminders.map((r) => `${r.title} due ${r.dueAt}`).join(" | ") : "none"}.`,
    `Idle 5+ days: ${ctx.idleJobs.length ? ctx.idleJobs.map((j) => `#${j.id} ${j.title}${j.propertyName ? ` @ ${j.propertyName}` : ""} (${j.daysIdle}d)`).join(" | ") : "none"}.`,
  ].join("\n");
}

/** Stream a chat reply over an SSE-shaped writer. */
export async function streamConciergeReply(
  history: Array<{ role: string; content: string }>,
  ctx: ConciergeContext,
  writer: (event: { type: string; data: unknown }) => void,
): Promise<ConciergeReply> {
  const oai = client();
  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "system", content: buildContextSystemMessage(ctx) },
    ...history.map((m) => ({
      role: (m.role === "assistant" ? "assistant" : "user") as "assistant" | "user",
      content: m.content,
    })),
  ];

  const stream = await oai.chat.completions.create({
    model: "gpt-5.4",
    max_completion_tokens: 8192,
    messages,
    tools: TOOLS,
    stream: true,
  });

  let content = "";
  // Collect tool-call deltas keyed by their `index` since OpenAI streams
  // them piece-by-piece.
  const toolBuffers = new Map<number, { name: string; args: string }>();

  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta;
    if (!delta) continue;
    if (typeof delta.content === "string" && delta.content.length > 0) {
      content += delta.content;
      writer({ type: "content", data: delta.content });
    }
    if (delta.tool_calls) {
      for (const tc of delta.tool_calls) {
        const idx = tc.index ?? 0;
        const existing = toolBuffers.get(idx) ?? { name: "", args: "" };
        if (tc.function?.name) existing.name = tc.function.name;
        if (tc.function?.arguments) existing.args += tc.function.arguments;
        toolBuffers.set(idx, existing);
      }
    }
  }

  const proposedActions: ProposedAction[] = [];
  for (const buf of toolBuffers.values()) {
    if (!buf.name) continue;
    let parsed: Record<string, unknown> = {};
    try {
      parsed = buf.args ? (JSON.parse(buf.args) as Record<string, unknown>) : {};
    } catch {
      // The stream sometimes emits invalid partial JSON if the model is
      // cut off mid-call; skip those rather than crashing the response.
      continue;
    }
    const action = actionFromToolCall(buf.name, parsed);
    if (action) proposedActions.push(action);
  }

  if (proposedActions.length > 0) {
    writer({ type: "proposed_actions", data: proposedActions });
  }
  return { content, proposedActions };
}

/**
 * Generate a small, deterministic-feeling list of proactive prompt
 * suggestions and an optional pep talk based on the user's current
 * context. Implementation is rules-only (no LLM round-trip) so the
 * sheet can show suggestions instantly on open.
 */
export function buildProactiveSuggestions(ctx: ConciergeContext): {
  suggestions: string[];
  pepTalk: string | null;
} {
  const suggestions: string[] = [];
  if (ctx.idleJobs.length >= 1) {
    suggestions.push(
      `You have ${ctx.idleJobs.length} job${ctx.idleJobs.length === 1 ? "" : "s"} idle for 5+ days — want to nudge clients?`,
    );
  }
  if (ctx.upcomingReminders.length === 0) {
    suggestions.push("Set a reminder for tomorrow morning's first stop.");
  } else if (ctx.upcomingReminders.length >= 3) {
    suggestions.push("Triage my reminders — what should I tackle first?");
  }
  if (ctx.recentLogs.length === 0) {
    suggestions.push("Log what I just finished.");
  } else {
    suggestions.push("Draft a client update for my last log.");
  }
  if (ctx.openWorkOrders.length > 0) {
    suggestions.push(
      `Open my next job: ${ctx.openWorkOrders[0].title.slice(0, 40)}.`,
    );
  }

  let pepTalk: string | null = null;
  if (ctx.recentLogs.length >= 5) {
    pepTalk = `${ctx.recentLogs.length} log${ctx.recentLogs.length === 1 ? "" : "s"} in the last two weeks — that's real momentum. Keep it rolling.`;
  } else if (ctx.recentLogs.length === 0 && ctx.openWorkOrders.length > 0) {
    pepTalk = "Quiet stretch on the timeline — one small log today gets the wheel turning again.";
  }

  return { suggestions: suggestions.slice(0, 4), pepTalk };
}

export async function getOrCreateConversation(
  userClerkId: string,
  outwardAccountId: number,
): Promise<ConciergeConversation> {
  // Race-safe upsert: two concurrent first-time requests for the same
  // (user, outward account) must always collapse to the same row. The
  // unique index `concierge_conversations_user_acct_unique` is what
  // makes ON CONFLICT DO NOTHING resolve correctly here.
  await db
    .insert(conciergeConversationsTable)
    .values({ userClerkId, outwardAccountId })
    .onConflictDoNothing({
      target: [
        conciergeConversationsTable.userClerkId,
        conciergeConversationsTable.outwardAccountId,
      ],
    });
  const [row] = await db
    .select()
    .from(conciergeConversationsTable)
    .where(
      and(
        eq(conciergeConversationsTable.userClerkId, userClerkId),
        eq(conciergeConversationsTable.outwardAccountId, outwardAccountId),
      ),
    );
  return row;
}

/** Per-user daily caps for the metered concierge endpoints. */
export const CONCIERGE_DAILY_LIMITS = {
  message: Number(process.env["CONCIERGE_DAILY_MESSAGE_LIMIT"] ?? 200),
  transcribe: Number(process.env["CONCIERGE_DAILY_TRANSCRIBE_LIMIT"] ?? 60),
} as const;

export type ConciergeUsageKind = keyof typeof CONCIERGE_DAILY_LIMITS;

export interface ConciergeQuotaCheck {
  allowed: boolean;
  used: number;
  limit: number;
  resetAt: Date;
}

/**
 * Count this user's concierge events of `kind` in the rolling 24h
 * window. Cheap (single indexed COUNT) and called inline before each
 * paid concierge request.
 */
export async function checkConciergeQuota(
  userClerkId: string,
  kind: ConciergeUsageKind,
): Promise<ConciergeQuotaCheck> {
  const limit = CONCIERGE_DAILY_LIMITS[kind];
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(conciergeUsageEventsTable)
    .where(
      and(
        eq(conciergeUsageEventsTable.userClerkId, userClerkId),
        eq(conciergeUsageEventsTable.kind, kind),
        gte(conciergeUsageEventsTable.createdAt, since),
      ),
    );
  const used = row?.count ?? 0;
  return {
    allowed: used < limit,
    used,
    limit,
    resetAt: new Date(since.getTime() + 24 * 60 * 60 * 1000),
  };
}

/** Append a usage event for the rolling-window meter. */
export async function recordConciergeUsage(
  userClerkId: string,
  outwardAccountId: number,
  kind: ConciergeUsageKind,
): Promise<void> {
  await db
    .insert(conciergeUsageEventsTable)
    .values({ userClerkId, outwardAccountId, kind });
}

export async function listMessages(conversationId: number): Promise<ConciergeMessage[]> {
  return db
    .select()
    .from(conciergeMessagesTable)
    .where(eq(conciergeMessagesTable.conversationId, conversationId))
    .orderBy(asc(conciergeMessagesTable.createdAt));
}

export async function appendMessage(
  conversationId: number,
  role: "user" | "assistant" | "system",
  content: string,
  proposedActions: ProposedAction[] | null = null,
): Promise<ConciergeMessage> {
  const [row] = await db
    .insert(conciergeMessagesTable)
    .values({
      conversationId,
      role,
      content,
      proposedActions: proposedActions as unknown[] | null,
    })
    .returning();
  await db
    .update(conciergeConversationsTable)
    .set({ updatedAt: new Date() })
    .where(eq(conciergeConversationsTable.id, conversationId));
  return row;
}

export async function clearMessages(conversationId: number): Promise<void> {
  await db
    .delete(conciergeMessagesTable)
    .where(eq(conciergeMessagesTable.conversationId, conversationId));
}

/** Transcribe a single audio buffer using the OpenAI transcription API. */
export async function transcribeAudio(
  audio: Buffer,
  filename: string,
): Promise<string> {
  const oai = client();
  const file = new File([new Uint8Array(audio)], filename, { type: "audio/m4a" });
  const out = await oai.audio.transcriptions.create({
    file,
    model: "gpt-4o-mini-transcribe",
    response_format: "json",
  });
  return (out as { text?: string }).text ?? "";
}
