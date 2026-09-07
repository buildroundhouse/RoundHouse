/**
 * Unit tests for the shared "<name> · <kind label>" suppression rule
 * (task #624). Pins the contract that #620 lifted into a shared util so
 * every profile surface (account switcher, public profile, full profile,
 * find, search results) renders identically and a regression here can't
 * silently re-introduce the "Home Home" duplication on home accounts.
 *
 * Round-house has no test runner of its own — api-server's vitest picks
 * this file up via its `vitest.config.ts` `include` glob.
 */
import { describe, it, expect } from "vitest";
import { kindLabelForName, nameContainsKindLabel } from "./account-display";

describe("nameContainsKindLabel", () => {
  it("returns true when the name contains every word of the label (exact match)", () => {
    expect(nameContainsKindLabel("My Home", "My Home")).toBe(true);
  });

  it("returns true for a single-word label fully present in the name", () => {
    expect(nameContainsKindLabel("Smith Home", "Home")).toBe(true);
  });

  it("returns false when the label has a word the name is missing (partial overlap)", () => {
    // "Smith Home" shares "home" with "My Home" but is missing "my" — the
    // label must still render so the surface reads "Smith Home · My Home".
    expect(nameContainsKindLabel("Smith Home", "My Home")).toBe(false);
  });

  it("returns false when no label words appear in the name", () => {
    expect(nameContainsKindLabel("Acme Plumbing", "Trade Pro")).toBe(false);
  });

  it("matches case-insensitively", () => {
    expect(nameContainsKindLabel("smith HOME", "Home")).toBe(true);
    expect(nameContainsKindLabel("MY home", "My Home")).toBe(true);
  });

  it("matches whole words only — substrings of larger words don't count", () => {
    // "Homestead" contains the substring "home" but not the whole word
    // "home", so the "Home" label should still render.
    expect(nameContainsKindLabel("Homestead Ranch", "Home")).toBe(false);
  });

  it("ignores surrounding punctuation when comparing words", () => {
    // Word boundaries split on punctuation so "Smith's Home," still
    // contains the whole word "home".
    expect(nameContainsKindLabel("Smith's Home,", "Home")).toBe(true);
  });

  it("handles multi-word labels where every word is present out of order", () => {
    expect(nameContainsKindLabel("Home Sweet My", "My Home")).toBe(true);
  });

  it("returns false for empty / nullish label inputs", () => {
    expect(nameContainsKindLabel("Smith Home", "")).toBe(false);
    expect(nameContainsKindLabel("Smith Home", null)).toBe(false);
    expect(nameContainsKindLabel("Smith Home", undefined)).toBe(false);
  });

  it("returns false for a label that is only punctuation / whitespace", () => {
    expect(nameContainsKindLabel("Smith Home", "   ")).toBe(false);
    expect(nameContainsKindLabel("Smith Home", "···")).toBe(false);
  });

  it("returns false for empty / nullish names when the label has real words", () => {
    expect(nameContainsKindLabel("", "Home")).toBe(false);
    expect(nameContainsKindLabel(null, "Home")).toBe(false);
    expect(nameContainsKindLabel(undefined, "Home")).toBe(false);
  });
});

describe("kindLabelForName", () => {
  it("returns null when the name already conveys the label (no duplication)", () => {
    expect(kindLabelForName("My Home", "My Home")).toBeNull();
    expect(kindLabelForName("Smith Home", "Home")).toBeNull();
  });

  it("returns the label when the name only partially overlaps it", () => {
    expect(kindLabelForName("Smith Home", "My Home")).toBe("My Home");
  });

  it("returns the label when the name is unrelated", () => {
    expect(kindLabelForName("Acme Plumbing", "Trade Pro")).toBe("Trade Pro");
  });

  it("returns null for empty / nullish labels (nothing to render)", () => {
    expect(kindLabelForName("Smith Home", "")).toBeNull();
    expect(kindLabelForName("Smith Home", null)).toBeNull();
    expect(kindLabelForName("Smith Home", undefined)).toBeNull();
  });

  it("returns the label unchanged when the name is empty", () => {
    expect(kindLabelForName("", "Home")).toBe("Home");
    expect(kindLabelForName(null, "Home")).toBe("Home");
  });
});
