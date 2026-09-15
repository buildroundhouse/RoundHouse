export type Resolution = {
  canAct?: boolean;
  id: number; creatorId: string; creatorName: string; otherName: string;
  recipientLinked: boolean; question: string; requestedAction: string | null; nextStep: string | null; context: string | null;
  status: "attention" | "waiting" | "resolved"; unread: boolean; followUps: number;
  createdAt: string; updatedAt: string; closedAt: string | null;
  events: { actorId: string; actorName: string; text: string; kind: "reply" | "follow_up" | "resolved"; at: string }[];
};
export const resolutionGroups = [
  { key: "attention", title: "Needs Your Attention", description: "Your response or action is next.", color: "#DC2626" },
  { key: "waiting", title: "Waiting on Them", description: "You’re waiting for a response or action.", color: "#16834A" },
  { key: "resolved", title: "Resolved", description: "Verified outcomes and permanent history.", color: "#7C838B" },
] as const;
export function orderedResolutions(items: Resolution[], status: Resolution["status"]) {
  return items.filter(r => r.status === status).sort((a, b) => {
    if (status === "resolved" && a.unread !== b.unread) return a.unread ? -1 : 1;
    if (status !== "resolved" && a.followUps !== b.followUps) return b.followUps - a.followUps;
    return Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
  });
}

export function resolutionSignalForItems(items: Resolution[]) {
  const active = items.filter(r => r.status !== "resolved" && r.canAct === true);
  const attention = active.filter(r => r.status === "attention").sort((a, b) => b.followUps - a.followUps)[0];
  return attention ? { responsibility: "you" as const, unansweredPrompts: attention.followUps + 1 }
    : active.length ? { responsibility: "them" as const, unansweredPrompts: 1 }
    : { responsibility: "empty" as const, unansweredPrompts: 0 };
}
