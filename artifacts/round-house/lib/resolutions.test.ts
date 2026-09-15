import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { orderedResolutions, type Resolution } from "./resolutions.ts";
const row = (id: number, status: Resolution["status"], unread = false, followUps = 0): Resolution => ({ id, status, unread, followUps, creatorId: "a", creatorName: "A", otherName: "B", recipientLinked: true, question: "Question", requestedAction: null, nextStep: null, context: null, createdAt: "2026-09-01", updatedAt: `2026-09-${String(id).padStart(2, "0")}`, closedAt: null, events: [] });
describe("Resolution list ordering", () => {
  it("keeps responsibilities separate and prioritizes unanswered follow-ups", () => {
    const items = [row(1, "waiting", false, 3), row(2, "attention"), row(3, "resolved"), row(4, "attention", false, 2)];
    assert.deepEqual(orderedResolutions(items, "attention").map(r => r.id), [4, 2]);
    assert.deepEqual(orderedResolutions(items, "waiting").map(r => r.id), [1]);
  });
  it("keeps unread closeouts prominent and returns read items to chronological history", () => {
    const items = [row(1, "resolved", true), row(2, "resolved")];
    assert.deepEqual(orderedResolutions(items, "resolved").map(r => r.id), [1, 2]);
    items[0].unread = false;
    assert.deepEqual(orderedResolutions(items, "resolved").map(r => r.id), [2, 1]);
  });
});
