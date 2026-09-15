import { describe, expect, it } from "vitest";
import { APPROVED_ROLE_TITLES, approvedSteps, freeLimitMessage, reviseApprovedDraft, titleAuthority, titleNeedsPersonalPaid, validateApprovedActivation, type ApprovedIntakeDraft } from "@workspace/api-zod";

const property: ApprovedIntakeDraft = { path: "property", propertyType: "residential", creating: true, roleTitle: "Homeowner", currentStep: "review", data: { address: "1 Main St", basicInfo: "Single family", ownershipAssertion: true } };
const trade: ApprovedIntakeDraft = { path: "trade", creating: true, roleTitle: "Trade Professional", currentStep: "review", data: { businessName: "Acme Trade", address: "2 Main St", yearsInBusiness: "4", services: "Carpentry", tradePosition: "Carpenter", yearsExperience: "6" } };
const supplier: ApprovedIntakeDraft = { path: "supplier", creating: true, roleTitle: "Supplier", currentStep: "review", data: { businessName: "Acme Supply", address: "3 Main St", yearsInBusiness: "8", services: "Lumber", supplierPosition: "Sales" } };

describe("approved intake policy", () => {
  it("uses the complete exact role catalogue", () => {
    expect(APPROVED_ROLE_TITLES.property).toEqual(["Homeowner", "Home Admin", "Home Pro (Owner)", "Home Pro (Manager)", "Home Pro (Teammate)", "Home (Viewer)"]);
    expect(APPROVED_ROLE_TITLES.trade).toContain("Trade Pro (Owner – Lead)");
    expect(APPROVED_ROLE_TITLES.supplier).toContain("Supplier Pro (Manager – Lead)");
  });
  it("builds every documented path in order", () => {
    expect(approvedSteps(property)).toEqual(["choose-path", "property-type", "find", "role", "profile", "role-details", "review", "complete"]);
    expect(approvedSteps(trade)).toEqual(["choose-path", "find", "role", "profile", "services", "trade-profile", "experience", "licenses", "review", "complete"]);
    expect(approvedSteps(supplier)).toEqual(["choose-path", "find", "role", "profile", "services", "supplier-profile", "review", "complete"]);
  });
  it.each([property, trade, supplier])("accepts a fully specified creation", (draft) => expect(validateApprovedActivation(draft)).toBeNull());
  it("rejects incomplete or unauthorized activation", () => {
    expect(validateApprovedActivation({ data: {} })).toMatch(/Choose/);
    expect(validateApprovedActivation({ path: "trade", creating: false, roleTitle: "Trade Professional", data: {} })).toMatch(/select/);
    expect(validateApprovedActivation({ ...property, roleTitle: "Home Pro (Manager)" })).toMatch(/authorization/);
    expect(validateApprovedActivation({ ...property, data: { ...property.data, ownershipAssertion: false } })).toMatch(/ownership/);
  });
  it("recalculates role state while retaining applicable data", () => {
    const next = reviseApprovedDraft({ ...property, data: { ...property.data, managementDetails: "old" } }, { roleTitle: "Home Pro (Manager)" });
    expect(next.data.address).toBe("1 Main St"); expect(next.data.ownershipAssertion).toBeUndefined(); expect(next.data.managementDetails).toBeUndefined();
  });
  it("keeps title, subscription, and authority separate", () => {
    expect(titleNeedsPersonalPaid("Trade Admin")).toBe(true); expect(titleNeedsPersonalPaid("Trade Professional")).toBe(false);
    expect(titleAuthority("Trade Pro (Manager – Lead)")).toMatchObject({ owner: false, manager: true, lead: true });
  });
  it("uses the shared approved free limits", () => {
    expect(freeLimitMessage("property")).toBe("You’ve reached your free account limit.\nAdd Pro to create another Property.");
    expect(freeLimitMessage("trade")).toBe("You’ve reached your free account limit.\nAdd Pro to create another Business.");
    expect(freeLimitMessage("supplier")).toBe(freeLimitMessage("trade"));
  });
});
