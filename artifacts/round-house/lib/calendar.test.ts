import { describe, expect, it } from "vitest";
import { calendarMonthDays, dayKey, sameLocalDay } from "./calendar";

describe("calendar display helpers", () => {
  it("builds a complete six-week Sunday-to-Saturday month grid", () => {
    const days = calendarMonthDays(new Date(2026, 8, 1));
    expect(days).toHaveLength(42);
    expect(days[0].getDay()).toBe(0);
    expect(days[41].getDay()).toBe(6);
    expect(days.some((day) => dayKey(day) === "2026-09-01")).toBe(true);
  });

  it("groups calendar records by local date", () => {
    expect(
      sameLocalDay(new Date(2026, 8, 15, 9), new Date(2026, 8, 15, 18)),
    ).toBe(true);
    expect(
      sameLocalDay(new Date(2026, 8, 15, 23), new Date(2026, 8, 16, 0)),
    ).toBe(false);
  });
});
