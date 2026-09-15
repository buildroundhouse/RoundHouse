export type ResolutionEvent = { actorId: string; text: string; kind: "reply" | "follow_up" | "resolved"; at: string };
export type ResolutionState = { context?: { id: number; name: string }; responsibleId: string | null; followUps: number; readBy: string[]; events: ResolutionEvent[] };
export type ResolutionSource = {
  userClerkId: string; counterpartyClerkId: string | null; status: string;
  responseText: string | null; updatedAt: Date; resolutionState?: ResolutionState | null;
};
export function resolutionState(q: ResolutionSource): ResolutionState {
  if (q.resolutionState) return q.resolutionState;
  return {
    responsibleId: q.responseText ? q.userClerkId : q.counterpartyClerkId,
    followUps: 0, readBy: q.status === "completed" ? [q.userClerkId] : [],
    // Legacy rows saved response text, but not its author or original time.
    events: q.responseText ? [{ actorId: "", text: q.responseText, kind: "reply", at: q.updatedAt.toISOString() }] : [],
  };
}
export class ResolutionError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export function changeResolution(q: ResolutionSource, userId: string, action: string, text: string, verified: boolean, now = new Date()) {
  if (userId !== q.userClerkId && userId !== q.counterpartyClerkId) throw new ResolutionError(404, "Resolution not found");
  const state = structuredClone(resolutionState(q));
  if (action === "read") {
    if (q.status === "completed" && !state.readBy.includes(userId)) state.readBy.push(userId);
    return { state, closed: q.status === "completed" };
  }
  if (q.status === "completed") throw new ResolutionError(409, "Resolved history cannot be changed");
  if (!["reply", "follow_up", "resolve"].includes(action)) throw new ResolutionError(400, "Unknown action");
  if (!text.trim() || text.length > 10000) throw new ResolutionError(400, "Enter a response of 1–10,000 characters");
  if (action === "resolve" && userId !== q.userClerkId) throw new ResolutionError(403, "Only the creator can resolve this item");
  if (action === "resolve" && !verified) throw new ResolutionError(400, "Verify the outcome before resolving");
  if (action === "follow_up" && state.responsibleId === userId) throw new ResolutionError(400, "This resolution needs your response");
  if (action === "reply") {
    state.responsibleId = userId === q.userClerkId ? q.counterpartyClerkId : q.userClerkId;
    state.followUps = 0;
  }
  if (action === "follow_up") state.followUps += 1;
  if (action === "resolve") { state.responsibleId = null; state.followUps = 0; state.readBy = [userId]; }
  state.events.push({ actorId: userId, text: text.trim(), kind: action === "resolve" ? "resolved" : action as "reply" | "follow_up", at: now.toISOString() });
  return { state, closed: action === "resolve" };
}
