import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ENTRY_CHOICES,
  PROPERTY_TYPES,
  relationshipChoices,
  readEntrySelection,
  entryDetailsRoute,
  entryOwnerMode,
} from "./entry-intake.ts";

test("intake starts with spaces, and property types are a separate decision", () => {
  assert.deepEqual(
    ENTRY_CHOICES.map((c) => c.label),
    ["Property", "Business"],
  );
  assert.deepEqual(
    PROPERTY_TYPES.map((c) => c.label),
    ["Residential", "Commercial"],
  );
  assert.deepEqual(
    relationshipChoices("property").map((c) => c.label),
    ["Owner", "Manager", "Home Team Member", "Viewer"],
  );
});
test("residential and commercial owners retain distinct types through the details route", () => {
  for (const propertyType of ["residential", "commercial"]) {
    const selection = readEntrySelection({
      entity: "property",
      propertyType,
      relationship: "owner",
    });
    assert.ok(selection);
    assert.equal(selection.propertyType, propertyType);
    assert.equal(entryDetailsRoute(selection), "/(onboarding)/entry-entity");
    assert.equal(
      entryOwnerMode(selection),
      propertyType === "residential" ? "home" : "facilities",
    );
  }
});
test("joining roles cannot accidentally create owner profiles", () => {
  for (const entity of ["property", "business"])
    for (const relationship of ["manager", "team_member", "viewer"]) {
      const selection = readEntrySelection({
        entity,
        propertyType: "commercial",
        businessType: "Carpenter",
        relationship,
      });
      assert.ok(selection);
      assert.equal(entryOwnerMode(selection), null);
      assert.equal(entryDetailsRoute(selection), "/(onboarding)/entry-access");
    }
});
test("business type survives role selection without leaking a prior property type", () => {
  const selection = readEntrySelection({
    entity: "business",
    businessType: "Designer",
    propertyType: "residential",
    relationship: "owner",
  });
  assert.deepEqual(selection, {
    entity: "business",
    businessType: "Designer",
    relationship: "owner",
  });
  assert.equal(entryDetailsRoute(selection!), "/(onboarding)/entry-business");
});
test("stale role-first URLs and incomplete or invalid selections are not accepted", () => {
  for (const params of [
    {},
    { entity: "property", relationship: "owner" },
    {
      entity: "property",
      propertyType: "residential",
      relationship: "collaborator",
    },
    { entity: "business", businessType: "", relationship: "owner" },
    { entity: "property", propertyType: "bad", relationship: "viewer" },
  ])
    assert.equal(readEntrySelection(params), null);
});
