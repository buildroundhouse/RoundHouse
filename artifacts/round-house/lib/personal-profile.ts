export const PERSONAL_FIELDS = [
  { key: "bio", label: "About / Bio", multiline: true },
  { key: "email", label: "Contact email" },
  { key: "phone", label: "Phone" },
  { key: "website", label: "Website" },
  { key: "social", label: "Social links", multiline: true },
  { key: "experience", label: "Experience", multiline: true },
  { key: "strengths", label: "Strengths / Specialties", multiline: true },
  { key: "certifications", label: "Certifications / Licenses", multiline: true },
] as const;
export type PersonalFieldKey = typeof PERSONAL_FIELDS[number]["key"];
export type PersonalDetails = Partial<Record<PersonalFieldKey, { value: string; public: boolean }>>;
export function readPersonalDetails(raw: unknown): PersonalDetails {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const source = raw as Record<string, unknown>;
  const result: PersonalDetails = {};
  for (const { key } of PERSONAL_FIELDS) {
    const field = source[key];
    if (field && typeof field === "object" && "value" in field && typeof field.value === "string") {
      result[key] = { value: field.value, public: "public" in field && field.public === true };
    }
  }
  return result;
}
export const PROFILE_ROLE_LABELS: Record<string, string> = {
  home: "Homeowner", trade_pro: "Trade Professional", facilities: "Commercial Management",
  home_teammate: "Home Team Member", trade_pro_teammate: "Trade Team Member",
  facilities_teammate: "Commercial Team Member", collab: "Viewer",
  trade_pro_collab: "Viewer", facilities_collab: "Viewer", viewer: "Viewer", supplier: "Supplier",
};

export function personalDetailsFromIntake(md: Record<string, unknown>): PersonalDetails {
  if (md.personalProfile && typeof md.personalProfile === "object") return readPersonalDetails(md.personalProfile);
  const visibility = (md.visibility ?? {}) as Record<string, unknown>;
  const text = (value: unknown) => typeof value === "string" ? value : Array.isArray(value) ? value.filter(v => typeof v === "string").join(", ") : "";
  return {
    bio: { value: text(md.bio), public: !!text(md.bio) },
    email: { value: text(md.contactEmail), public: visibility.email === true },
    phone: { value: text(md.phone), public: visibility.phone === true },
    website: { value: text(md.website), public: visibility.website === true },
    social: { value: text(md.instagram), public: visibility.instagram === true },
    experience: { value: text(md.experience), public: !!text(md.experience) },
    strengths: { value: text(md.strengths), public: !!text(md.strengths) },
    certifications: { value: [md.licenseType, md.licenseState, md.licenseNumber].map(text).filter(Boolean).join(" · "), public: visibility.license === true },
  };
}

export type ProfileEntity = {
  id: number; displayName: string; kind: string; logoUrl?: string | null;
  myMembership: { role: string; status: string; direction?: string; permissions?: Record<string, unknown> } | null;
};

/** Titles are descriptive; only approved Entity membership establishes authority. */
export function profileContext(kind: string | undefined, md: Record<string, unknown>, entities: ProfileEntity[]) {
  const memberships = entities.filter(e => e.myMembership?.status === "approved" && (!isViewerKind(kind) || e.kind === "property" || e.kind === "facility"));
  const requestedId = Number(md.entityId);
  // Primary identity differs by role: a trade avatar represents a Business,
  // even when that avatar also works at several client Properties.
  const viewer = isViewerKind(kind);
  const primary = memberships.filter(e => viewer ? e.kind !== "business"
    : kind?.startsWith("trade_pro") || kind === "supplier" ? e.kind === "business"
    : kind?.startsWith("facilities") ? e.kind === "facility" : e.kind === "property");
  const entity = primary.find(e => e.id === requestedId) ?? (primary.length === 1 ? primary[0] : null);
  const baseRole = PROFILE_ROLE_LABELS[kind ?? "collab"] ?? "Viewer";
  const authority = entity?.myMembership?.role;
  const authorityLabel = ({ owner: "Owner", admin: "Admin", manager: "Manager" } as Record<string, string>)[authority ?? ""];
  const role = baseRole === "Viewer" ? "Viewer"
    : kind === "home" && authority === "manager" ? "Home Manager"
    : authorityLabel && !(kind === "home" && authority === "owner") ? `${baseRole} (${authorityLabel})` : baseRole;
  const savedName = typeof md.placeName === "string" ? md.placeName : typeof md.companyName === "string" ? md.companyName : "";
  const entityName = entity?.displayName ?? (primary.length > 1 ? primary.map(e => e.displayName).join(" · ") : savedName || "No Entity participation yet");
  return { role, entity, entityName, memberships };
}

export function isViewerKind(kind: string | null | undefined) {
  return !kind || ["viewer", "collab", "trade_pro_collab", "facilities_collab"].includes(kind);
}

/** Never edit another mode's personal information while an outward account is selected. */
export function modeForAccount<T extends { id: number; kind: string }>(
  account: { kind?: string; sourceUserModeId?: number | null } | null,
  modes: T[], activeMode: T | null,
): T | null {
  if (account?.sourceUserModeId != null) return modes.find(m => m.id === account.sourceUserModeId) ?? null;
  return !account?.kind || activeMode?.kind === account.kind ? activeMode : null;
}
