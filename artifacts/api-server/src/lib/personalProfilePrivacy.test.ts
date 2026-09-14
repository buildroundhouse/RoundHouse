import { describe, expect, it } from "vitest";
import { protectPersonalProfile, validatePersonalProfile } from "./personalProfilePrivacy";
describe("personal profile privacy", () => {
  const intake = { companyName: "Preserved Entity", experience: "old private history", contactEmail: "old-private@example.test", phone: "old phone", personalProfile: {
    bio: { value: "Public biography", public: true }, email: { value: "private@example.test", public: false },
    experience: { value: "Private history", public: false }, phone: { value: "Public phone", public: true },
  } };
  it("keeps private values out of the response and duplicate legacy fields", () => {
    const result = protectPersonalProfile(intake, false);
    expect(JSON.stringify(result)).not.toContain("private@example.test");
    expect(JSON.stringify(result)).not.toContain("Private history");
    expect(JSON.stringify(result)).not.toContain("old private");
    expect(result.intake).toMatchObject({ companyName: "Preserved Entity", personalProfile: { bio: { value: "Public biography", public: true } } });
    expect(result.userOverrides.phone).toBe("Public phone");
    expect(intake.contactEmail).toBe("old-private@example.test");
  });
  it("preserves self editing and legacy profiles", () => {
    expect(protectPersonalProfile(intake, true).intake).toBe(intake);
    const legacy = { bio: "legacy" }; expect(protectPersonalProfile(legacy, false).intake).toBe(legacy);
  });
  it("honors contact restrictions even when a field is public", () => {
    const result = protectPersonalProfile(intake, false, true);
    expect(JSON.stringify(result)).not.toContain("Public phone");
    expect(result.userOverrides.phone).toBeNull();
  });
  it("rejects malformed fields and truthy strings as visibility", () => {
    for (const raw of [null, [], { surprise: { value: "x", public: true } }, { bio: { value: "x", public: "true" } }, { bio: { value: "x".repeat(2001), public: true } }]) expect(validatePersonalProfile(raw)).toBeTruthy();
    expect(validatePersonalProfile(intake.personalProfile)).toBeNull();
  });
});
