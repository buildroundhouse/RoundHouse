import type { CalendarParty } from "@workspace/db";
export class CalendarError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export const manager = (m?: {
  role: string;
  permissions?: { manageTeam?: boolean };
}) => !!m && ["owner", "admin", "manager"].includes(m.role);
export const operational = (kind?: string) =>
  !!kind &&
  !["viewer", "collab", "trade_pro_collab", "facilities_collab"].includes(kind);
export function scheduleInput(body: any) {
  const startsAt = new Date(body.startsAt),
    duration = Number(body.duration);
  if (
    !body.startsAt ||
    !Number.isFinite(startsAt.getTime()) ||
    !Number.isInteger(duration) ||
    duration < 5 ||
    duration > 1440
  )
    throw new CalendarError(
      400,
      "Choose a valid date, time and duration (5–1440 minutes).",
    );
  return { startsAt, duration };
}
export const confirmationStatus = (parties: CalendarParty[]) =>
  parties.every((p) => !p.required || p.response === "accepted")
    ? "confirmed"
    : "pending";
export function respond(
  parties: CalendarParty[],
  account: number,
  action: string,
  message: unknown,
  suggestedAt?: unknown,
) {
  const p = parties.find((p) => p.accountId === account);
  if (!p || !p.required)
    throw new CalendarError(
      403,
      "This appointment does not require your response.",
    );
  if (!["accept", "decline", "suggest", "message"].includes(action))
    throw new CalendarError(400, "Choose a valid response.");
  const note = typeof message === "string" ? message.trim() : "";
  if (note.length > 2000 || (action === "message" && !note))
    throw new CalendarError(400, "Add a message of up to 2000 characters.");
  if (action === "suggest") {
    const date = new Date(String(suggestedAt));
    if (!Number.isFinite(date.getTime()))
      throw new CalendarError(400, "Choose the alternative date and time.");
    p.suggestedAt = date.toISOString();
  }
  if (action !== "message")
    p.response =
      action === "accept"
        ? "accepted"
        : action === "decline"
          ? "declined"
          : "suggested";
  if (note) p.message = note;
  return parties;
}
