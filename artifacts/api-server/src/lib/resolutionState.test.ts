import { describe, expect, it } from "vitest";
import { changeResolution, resolutionState, type ResolutionSource } from "./resolutionState";
const original: ResolutionSource = { userClerkId: "creator", counterpartyClerkId: "recipient", status: "open", responseText: null, updatedAt: new Date("2026-09-01") };
describe("Resolution responsibility and permanent closeout", () => {
  it("preserves legacy responses and assigns the next response to the creator", () => {
    const state = resolutionState({ ...original, status: "answered", responseText: "Saturday works" });
    expect(state.responsibleId).toBe("creator"); expect(state.events[0].text).toBe("Saturday works");
  });
  it("passes responsibility on a reply without closing and preserves each response", () => {
    const first = changeResolution(original, "recipient", "reply", "I can schedule it", false);
    expect(first.closed).toBe(false); expect(first.state.responsibleId).toBe("creator");
    const second = changeResolution({ ...original, resolutionState: first.state }, "creator", "reply", "Please confirm the time", false);
    expect(second.state.responsibleId).toBe("recipient"); expect(second.state.events).toHaveLength(2);
  });
  it("counts unanswered follow-ups on this item and resets only on a response", () => {
    let q = { ...original };
    for (let i = 1; i <= 3; i++) { const result = changeResolution(q, "creator", "follow_up", "Following up", false); q = { ...q, resolutionState: result.state }; expect(result.state.followUps).toBe(i); }
    expect(changeResolution(q, "recipient", "reply", "Here is the result", false).state.followUps).toBe(0);
  });
  it("rejects a follow-up when it is your own turn", () => {
    expect(() => changeResolution(original, "recipient", "follow_up", "Hello", false)).toThrow("needs your response");
  });
  it("requires the creator, deliberate verification and a closeout record", () => {
    expect(() => changeResolution(original, "recipient", "resolve", "Done", true)).toThrow("Only the creator");
    expect(() => changeResolution(original, "creator", "resolve", "Done", false)).toThrow("Verify the outcome");
    expect(() => changeResolution(original, "creator", "resolve", "", true)).toThrow("Enter a response");
    const result = changeResolution(original, "creator", "resolve", "Confirmed appointment on calendar", true);
    expect(result.closed).toBe(true); expect(result.state.readBy).toEqual(["creator"]); expect(result.state.events[0].kind).toBe("resolved");
  });
  it("keeps the resolved unread flag specific to the participant who opened it", () => {
    const result = changeResolution(original, "creator", "resolve", "Verified", true);
    const closed = { ...original, status: "completed", resolutionState: result.state };
    const read = changeResolution(closed, "recipient", "read", "", false);
    expect(read.state.readBy).toEqual(["creator", "recipient"]); expect(read.state.events).toEqual(result.state.events);
    expect(result.state.readBy).toEqual(["creator"]);
  });
  it("rejects outsiders and prevents changes to resolved history", () => {
    for (const action of ["read", "reply", "follow_up", "resolve"]) expect(() => changeResolution(original, "stranger", action, "hello", true)).toThrow("not found");
    expect(() => changeResolution({ ...original, status: "completed" }, "creator", "reply", "rewrite", false)).toThrow("history cannot be changed");
  });
});
