const FIELD_KEYS = ["bio", "email", "phone", "website", "social", "experience", "strengths", "certifications"] as const;
type PersonalField = { value: string; public: boolean };
export function validatePersonalProfile(raw: unknown): string | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return "Personal profile must be an object.";
  for (const [key, field] of Object.entries(raw)) {
    if (!(FIELD_KEYS as readonly string[]).includes(key)) return "Unknown personal profile field.";
    if (!field || typeof field !== "object" || Array.isArray(field)) return "Invalid personal profile field.";
    const f = field as Record<string, unknown>;
    if (typeof f.value !== "string" || f.value.length > 2000 || typeof f.public !== "boolean") return "Each profile field needs text (up to 2000 characters) and a visibility choice.";
  }
  return null;
}
/** Redact both the current profile and legacy duplicate values before leaving the server. */
export function protectPersonalProfile(intake: Record<string, unknown>, isSelf: boolean, redactContacts = false) {
  const raw = intake.personalProfile;
  if (!raw || typeof raw !== "object" || Array.isArray(raw) || isSelf) return { intake, userOverrides: {} as Record<string, unknown> };
  const fields = raw as Record<string, unknown>;
  const publicFields: Record<string, PersonalField> = {};
  for (const key of FIELD_KEYS) {
    const f = fields[key] as PersonalField | undefined;
    if (f && typeof f.value === "string" && f.public === true && !(redactContacts && (key === "email" || key === "phone"))) {
      publicFields[key] = { value: f.value, public: true };
    }
  }
  const safe: Record<string, unknown> = { ...intake, personalProfile: publicFields };
  for (const key of ["bio", "contactEmail", "email", "phone", "cellPhone", "officePhone", "website", "instagram", "experience", "strengths", "licenseState", "licenseType", "licenseNumber"]) delete safe[key];
  return {
    intake: safe,
    userOverrides: {
      bio: publicFields.bio?.value ?? null,
      email: publicFields.email?.value ?? "", phone: publicFields.phone?.value ?? null,
      cellPhone: null, officePhone: null, website: publicFields.website?.value ?? null,
      instagram: null, licenseState: null, licenseType: null, licenseNumber: null,
    } as Record<string, unknown>,
  };
}
