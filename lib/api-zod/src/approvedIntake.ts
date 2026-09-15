export const APPROVED_ROLE_TITLES = {
  property: ["Homeowner", "Home Admin", "Home Pro (Owner)", "Home Pro (Manager)", "Home Pro (Teammate)", "Home (Viewer)"],
  trade: ["Trade Professional", "Trade Admin", "Trade Pro (Owner)", "Trade Pro (Manager)", "Trade Pro (Lead)", "Trade Pro (Owner – Lead)", "Trade Pro (Manager – Lead)"],
  supplier: ["Supplier", "Supplier Admin", "Supplier Pro (Owner)", "Supplier Pro (Manager)", "Supplier Pro (Lead)", "Supplier Pro (Owner – Lead)", "Supplier Pro (Manager – Lead)"],
} as const;

export type ApprovedIntakePath = keyof typeof APPROVED_ROLE_TITLES;
export type ApprovedRoleTitle = (typeof APPROVED_ROLE_TITLES)[ApprovedIntakePath][number];

export type ApprovedIntakeDraft = {
  path?: ApprovedIntakePath;
  propertyType?: "residential" | "commercial";
  roleTitle?: ApprovedRoleTitle;
  existingEntityId?: number;
  creating?: boolean;
  currentStep?: string;
  returnToReview?: boolean;
  data: Record<string, unknown>;
};

export function approvedSteps(draft: ApprovedIntakeDraft): string[] {
  if (draft.path === "property") {
    return ["choose-path", "property-type", "find", "role", ...(draft.creating ? ["profile"] : []), "role-details", "review", "complete"];
  }
  if (draft.path === "trade") {
    return ["choose-path", "find", "role", ...(draft.creating || draft.data.profileRequired ? ["profile"] : []), "services", "trade-profile", "experience", "licenses", "review", "complete"];
  }
  if (draft.path === "supplier") {
    return ["choose-path", "find", "role", "profile", "services", "supplier-profile", "review", "complete"];
  }
  return ["choose-path"];
}

export function titleAuthority(title: string) {
  return {
    owner: title === "Homeowner" || title.includes("(Owner"),
    admin: title.endsWith(" Admin"),
    manager: title.includes("(Manager"),
    lead: title.includes("Lead)"),
    viewer: title === "Home (Viewer)",
  };
}

export function titleNeedsPersonalPaid(title: string): boolean {
  return title.endsWith(" Admin") || title.includes(" Pro (");
}

export function validApprovedTitle(path: ApprovedIntakePath, title: string): title is ApprovedRoleTitle {
  return (APPROVED_ROLE_TITLES[path] as readonly string[]).includes(title);
}

export function reviseApprovedDraft(draft: ApprovedIntakeDraft, patch: Partial<ApprovedIntakeDraft>): ApprovedIntakeDraft {
  const next = { ...draft, ...patch, data: { ...draft.data, ...(patch.data ?? {}) } };
  if (patch.path && patch.path !== draft.path) {
    delete next.propertyType; delete next.roleTitle; delete next.existingEntityId; delete next.creating;
  }
  if (patch.propertyType && patch.propertyType !== draft.propertyType) {
    delete next.existingEntityId; delete next.creating;
  }
  if (next.path && next.roleTitle && !validApprovedTitle(next.path, next.roleTitle)) delete next.roleTitle;
  if (patch.roleTitle && patch.roleTitle !== draft.roleTitle) {
    delete next.data.ownershipAssertion; delete next.data.managementDetails;
  }
  return next;
}

export function freeLimitMessage(path: ApprovedIntakePath): string {
  const noun = path === "property" ? "Property" : "Business";
  return `You’ve reached your free account limit.\nAdd Pro to create another ${noun}.`;
}

export function validateApprovedActivation(draft: ApprovedIntakeDraft): string | null {
  if (!draft || !draft.path || !Object.prototype.hasOwnProperty.call(APPROVED_ROLE_TITLES, draft.path)) return "Choose PROPERTY, TRADE, or SUPPLIER.";
  if (!draft.data || typeof draft.data !== "object" || Array.isArray(draft.data)) return "Intake details are required.";
  if (draft.path === "property" && !["residential", "commercial"].includes(draft.propertyType ?? "")) return "Choose Residential or Commercial.";
  if (draft.creating !== undefined && typeof draft.creating !== "boolean") return "Choose an existing record or create a new one.";
  if (draft.existingEntityId !== undefined && (!Number.isSafeInteger(draft.existingEntityId) || draft.existingEntityId <= 0)) return "Select a valid existing record.";
  if (draft.creating && draft.existingEntityId) return "Choose an existing record or create a new one.";
  if (!draft.creating && !draft.existingEntityId) return "Find and select a Property or Business.";
  if (!draft.roleTitle || !validApprovedTitle(draft.path, draft.roleTitle)) return "Choose an approved role.";
  const authority = titleAuthority(draft.roleTitle);
  if (authority.owner && draft.data.ownershipAssertion !== true) return "Confirm legitimate ownership before activation.";
  if (draft.creating) {
    if (!String(draft.data.address ?? "").trim()) return "Address is required.";
    if (draft.path !== "property" && !String(draft.data.businessName ?? "").trim()) return "Business name is required.";
    if (draft.path === "property" && !String(draft.data.basicInfo ?? "").trim()) return "Basic Property information is required.";
    if (draft.path !== "property" && !String(draft.data.yearsInBusiness ?? "").trim()) return "Years in business is required.";
    if (authority.viewer || authority.manager || draft.roleTitle === "Home Pro (Teammate)") return "That role requires authorization from an existing record.";
  }
  if (draft.path !== "property" && !String(draft.data.services ?? "").trim()) return "Products or services are required.";
  if (draft.path === "trade" && !String(draft.data.tradePosition ?? "").trim()) return "Trade / position is required.";
  if (draft.path === "trade" && !String(draft.data.yearsExperience ?? "").trim()) return "Years of experience is required.";
  if (draft.path === "supplier" && !String(draft.data.supplierPosition ?? "").trim()) return "Supplier position or responsibility is required.";
  return null;
}
