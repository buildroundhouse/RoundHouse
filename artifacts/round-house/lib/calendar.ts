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
export type AvailabilitySlot = {
  id: number;
  startsAt: string;
  endsAt: string;
};
export const dayKey = (value: Date | string) => {
  const date = value instanceof Date ? value : new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};
export const sameLocalDay = (a: Date | string, b: Date | string) =>
  dayKey(a) === dayKey(b);
export function calendarMonthDays(month: Date) {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const start = new Date(first);
  start.setDate(first.getDate() - first.getDay());
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    return date;
  });
}
export const monthTitle = (month: Date) =>
  month.toLocaleDateString(undefined, { month: "long", year: "numeric" });
export const timeRange = (
  startsAt: string,
  endsAt?: string,
  duration?: number,
) => {
  const start = new Date(startsAt);
  const end = endsAt
    ? new Date(endsAt)
    : new Date(start.getTime() + (duration ?? 0) * 60_000);
  const format = (date: Date) =>
    date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return `${format(start)}–${format(end)}`;
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
