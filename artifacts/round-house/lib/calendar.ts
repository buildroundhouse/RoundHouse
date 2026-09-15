export type CalendarAppointment = {
  id: number;
  revision: number;
  title: string;
  propertyName: string;
  propertyId: number | null;
  address: string;
  startsAt: string;
  duration: number;
  status: "proposed" | "pending" | "confirmed" | "cancelled";
  canManage: boolean;
  canRespond: boolean;
  myAssignment: boolean;
  clientUserId?: string;
  clientAccountId?: number;
  parties: {
    accountId: number;
    name: string;
    role: string;
    response: string;
    required: boolean;
    message?: string;
    suggestedAt?: string;
  }[];
  events: {
    action: string;
    at: string;
    startsAt?: string;
    duration?: number;
    message?: string;
  }[];
};
export type CalendarContexts = {
  businesses: { id: number; name: string }[];
  properties: {
    id: number;
    name: string;
    canScheduleOwn: boolean;
    people: { accountId: number; name: string; homeowner: boolean }[];
  }[];
};
export const calendarStatus = (status: string) =>
  ({
    proposed: "Proposed",
    pending: "Pending Confirmation",
    confirmed: "Confirmed",
    cancelled: "Cancelled",
  })[status] ?? status;
export function localInput(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}
export function parseCalendarTime(value: string) {
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(value))
    throw new Error("Use YYYY-MM-DD HH:MM for your local date and time.");
  const date = new Date(value.replace(" ", "T"));
  if (!Number.isFinite(date.getTime()) || localInput(date) !== value)
    throw new Error("Choose a valid local date and time.");
  return date.toISOString();
}
