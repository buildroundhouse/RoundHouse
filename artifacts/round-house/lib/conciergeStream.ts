/**
 * Lightweight wrappers around the AI concierge SSE streaming endpoint and
 * the binary voice-transcription endpoint.
 *
 * The Orval-generated client returns either typed JSON or a thrown
 * `ApiError`, neither of which fits Server-Sent Events (which require
 * line-by-line parsing of a long-lived response body). We therefore use
 * raw `fetch` here while still re-using the shared bearer token + active
 * outward-account headers that the rest of the app expects.
 */
import { ApiError } from "@workspace/api-client-react";
import { auth } from "./firebase";
import { maybeShowPaywallFromError } from "./paywallSheet";

const API_BASE = process.env.EXPO_PUBLIC_DOMAIN
  ? `https://${process.env.EXPO_PUBLIC_DOMAIN}`
  : "";

export interface ProposedAction {
  type:
    | "draft_client_note"
    | "create_reminder"
    | "log_work_item"
    | "open_job"
    | "pep_talk";
  label: string;
  payload: Record<string, unknown>;
}

export interface ConciergeMessageDTO {
  id: number;
  role: "user" | "assistant" | "system";
  content: string;
  proposedActions: ProposedAction[];
  createdAt: string;
}

export interface StreamEvent {
  type: "content" | "proposed_actions" | "done" | "error";
  data: unknown;
}

interface SendOptions {
  outwardAccountId: number | null;
  signal?: AbortSignal;
  onEvent: (e: StreamEvent) => void;
}

async function authHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = {};
  const u = auth?.currentUser;
  if (u) {
    try {
      const token = await u.getIdToken();
      if (token) headers["authorization"] = `Bearer ${token}`;
    } catch {
      // ignore — server will return 401 and the UI will handle it.
    }
  }
  return headers;
}

/**
 * POST a user message and stream the assistant reply over SSE. Resolves
 * once the stream closes, or throws an `ApiError` on a non-2xx response
 * so the global paywall handler can surface a 402.
 */
export async function streamConciergeReply(
  content: string,
  { outwardAccountId, signal, onEvent }: SendOptions,
): Promise<void> {
  const headers = await authHeaders();
  headers["content-type"] = "application/json";
  headers["accept"] = "text/event-stream";
  if (outwardAccountId != null) {
    headers["x-active-outward-account-id"] = String(outwardAccountId);
  }

  const res = await fetch(`${API_BASE}/api/concierge/messages`, {
    method: "POST",
    headers,
    body: JSON.stringify({ content }),
    signal,
  });

  if (!res.ok) {
    let data: unknown = null;
    try {
      data = await res.json();
    } catch {
      try {
        data = await res.text();
      } catch {
        data = null;
      }
    }
    const err = new ApiError(res, data, {
      method: "POST",
      url: `${API_BASE}/api/concierge/messages`,
    });
    maybeShowPaywallFromError(err);
    throw err;
  }

  const reader = res.body?.getReader();
  if (!reader) {
    throw new Error("Streaming is not supported in this runtime.");
  }
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      // SSE frames are separated by a blank line.
      let sep: number;
      while ((sep = buffer.indexOf("\n\n")) !== -1) {
        const frame = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        const dataLine = frame
          .split("\n")
          .filter((l) => l.startsWith("data:"))
          .map((l) => l.slice(5).trimStart())
          .join("\n");
        if (!dataLine) continue;
        try {
          const evt = JSON.parse(dataLine) as StreamEvent;
          onEvent(evt);
        } catch {
          // Skip malformed frames — the model should never produce them
          // but guarding here keeps the stream resilient.
        }
      }
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // no-op
    }
  }
}

/** POST raw audio bytes for transcription. */
export async function transcribeConciergeAudio(
  audio: ArrayBuffer | Blob,
  filename = "voice.m4a",
): Promise<string> {
  const headers = await authHeaders();
  headers["content-type"] = "application/octet-stream";
  const res = await fetch(
    `${API_BASE}/api/concierge/transcribe?filename=${encodeURIComponent(filename)}`,
    { method: "POST", headers, body: audio as BodyInit },
  );
  if (!res.ok) {
    let data: unknown = null;
    try {
      data = await res.json();
    } catch {
      data = null;
    }
    const err = new ApiError(res, data, {
      method: "POST",
      url: `${API_BASE}/api/concierge/transcribe`,
    });
    maybeShowPaywallFromError(err);
    throw err;
  }
  const out = (await res.json()) as { text?: string };
  return out.text ?? "";
}
