import { describe, it, expect } from "vitest";
import { commandCenterIdentity } from "./command-center-identity";
import { profileContext, modeForAccount, type ProfileEntity } from "./personal-profile";
import { resolutionSignalForItems, type Resolution } from "./resolutions";
const entity = (id: number, kind: string, role: string): ProfileEntity => ({ id, kind, displayName: `Space ${id}`, myMembership: { role, status: "approved" } });
describe("account-specific page identity", () => {
  it.each([
    ["home", "property", "owner"], ["home", "property", "manager"],
    ["home_teammate", "property", "worker"], ["trade_pro", "business", "owner"],
    ["trade_pro_teammate", "business", "employee"], ["facilities", "facility", "manager"],
    ["facilities_teammate", "facility", "worker"], ["collab", "property", "collaborator"],
  ])("%s has the same role and Entity across Command Center and Profile", (kind, space, role) => {
    const entities = [entity(1, space, role)];
    const profile = profileContext(kind, {}, entities);
    expect(commandCenterIdentity({ kind }, { id: 1, kind }, entities)).toEqual({ roleLabel: profile.role, entityName: profile.entityName });
  });
  it("makes multi-home scope explicit", () => {
    expect(commandCenterIdentity({ kind: "home" }, { id: 1, kind: "home", intakeData: { entityId: 1 } }, [entity(1, "property", "owner"), entity(2, "property", "owner")]).entityName).toBe("My Homes / Properties");
  });
  it("does not mistake client Property management for Business ownership", () => {
    const context = profileContext("trade_pro_teammate", { entityId: 2 }, [entity(1, "business", "employee"), entity(2, "property", "manager")]);
    expect(context.entity?.id).toBe(1); expect(context.role).toBe("Trade Team Member");
  });
  it("does not create a Trade Viewer identity from legacy membership", () => {
    expect(profileContext("trade_pro_collab", {}, [entity(1, "business", "owner")]).entity).toBeNull();
    expect(profileContext("trade_pro_collab", {}, [entity(1, "business", "owner")]).role).toBe("Viewer");
  });
  it("resolves the selected account's mode and never edits another role during switching", () => {
    const home = { id: 1, kind: "home" }, trade = { id: 2, kind: "trade_pro" };
    expect(modeForAccount({ kind: "trade_pro", sourceUserModeId: 2 }, [home, trade], home)).toBe(trade);
    expect(modeForAccount({ kind: "trade_pro", sourceUserModeId: 2 }, [home], home)).toBeNull();
    expect(modeForAccount({ kind: "trade_pro" }, [home], home)).toBeNull();
  });
});
describe("shared Resolution responsibility", () => {
  const row = (status: Resolution["status"], followUps = 0, canAct = true) => ({ status, followUps, canAct }) as Resolution;
  it("follows replies back to the creator and counts only that thread's prompts", () => {
    expect(resolutionSignalForItems([row("attention", 2), row("waiting", 5)])).toEqual({ responsibility: "you", unansweredPrompts: 3 });
    expect(resolutionSignalForItems([row("waiting")]).responsibility).toBe("them");
    expect(resolutionSignalForItems([row("resolved")]).responsibility).toBe("empty");
  });
  it("does not demand action from a read-only avatar", () => {
    expect(resolutionSignalForItems([row("attention", 4, false)]).responsibility).toBe("empty");
  });
});
