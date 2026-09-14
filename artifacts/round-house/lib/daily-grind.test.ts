import { describe, expect, it } from "vitest";
import { dayAt, itemRef, localDay, remindersForDay } from "./daily-grind";
describe("Daily Grind planning", () => {
  it("uses local calendar dates across month and year boundaries", () => {
    expect(localDay(dayAt(1, new Date(2026, 11, 31, 9)))).toBe("2027-01-01");
    expect(localDay(dayAt(-1, new Date(2026, 0, 1, 9)))).toBe("2025-12-31");
  });
  it("includes overdue unfinished reminders today without pulling tomorrow forward", () => {
    const items = [
      { dueAt: new Date(2026, 8, 13, 10).toISOString(), done: false },
      { dueAt: new Date(2026, 8, 14, 10).toISOString(), done: true },
      { dueAt: new Date(2026, 8, 15, 10).toISOString(), done: false },
    ];
    expect(remindersForDay(items, "2026-09-14", "2026-09-14")).toEqual([
      items[0],
    ]);
    expect(remindersForDay(items, "2026-09-15", "2026-09-14")).toEqual([
      items[2],
    ]);
  });
  it("keeps references distinct across source lists, without copying text", () => {
    expect(itemRef("a", "bc")).not.toBe(itemRef("ab", "c"));
    expect(JSON.parse(itemRef("shopping", "item-1"))).toEqual([
      "shopping",
      "item-1",
    ]);
  });
});
