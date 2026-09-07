/**
 * Task #502 — universal label + chip pattern.
 *
 * Single place that encodes:
 *   - the curated chip lists for each picker (collaborator chip,
 *     Trade Pro on-site identity, Trade Pro teammate, Facility teammate),
 *   - the human-readable display label for each enum value,
 *   - the rendering helper that produces the `Label · Chip` text
 *     shown directly under a person's name everywhere they appear.
 *
 * Keeping this in one file means PeopleModal, PublicProfileModal,
 * TeamSection, ManageTeamModal, ConnectionTagModal etc. stay in lock
 * step on copy and ordering.
 */

export type Classification = "worker" | "outside_service_provider";

/**
 * #504 — hire-cadence sub-bucket for the hirer's view of a Trade Pro
 * / Outside Service connection. Drives the Occasional / Recurring
 * split inside the My Team layouts.
 */
export type Cadence = "occasional" | "recurring";

export const CADENCE_OPTIONS: { value: Cadence; label: string; help: string }[] = [
  {
    value: "occasional",
    label: "Occasional",
    help: "One-off or as-needed jobs.",
  },
  {
    value: "recurring",
    label: "Recurring",
    help: "Regular, ongoing work.",
  },
];

export function cadenceLabel(value: string | null | undefined): string {
  if (value === "recurring") return "Recurring";
  return "Occasional";
}

export type OnSiteIdentity =
  | "contractor"
  | "handyman"
  | "specialist"
  | "technician"
  | "vendor"
  | "other";

export type CollaboratorChip =
  | "mom"
  | "dad"
  | "spouse"
  | "sibling"
  | "boyfriend"
  | "girlfriend"
  | "old_friend"
  | "new_friend"
  | "friend"
  | "neighbor"
  | "designer"
  | "other";

export type TradeProTeammateChip =
  | "plumbing"
  | "carpentry"
  | "electrical"
  | "painting"
  | "roofing"
  | "landscaping"
  | "other";

export type FacilityTeammateChip =
  | "maintenance"
  | "housekeeping"
  | "gardener"
  | "security"
  | "concierge"
  | "office"
  | "other";

export const CLASSIFICATION_OPTIONS: { value: Classification; label: string; help: string }[] = [
  {
    value: "worker",
    label: "Worker",
    help: "An employee or recurring helper who works inside the property.",
  },
  {
    value: "outside_service_provider",
    label: "Outside service provider",
    help: "A vendor or trade pro you call in for specific jobs.",
  },
];

export const ON_SITE_IDENTITY_OPTIONS: { value: OnSiteIdentity; label: string }[] = [
  { value: "contractor", label: "Contractor" },
  { value: "handyman", label: "Handyman" },
  { value: "specialist", label: "Specialist" },
  { value: "technician", label: "Technician" },
  { value: "vendor", label: "Vendor" },
  { value: "other", label: "Other…" },
];

export const COLLABORATOR_CHIP_OPTIONS: { value: CollaboratorChip; label: string; heart?: boolean }[] = [
  { value: "mom", label: "Mom" },
  { value: "dad", label: "Dad" },
  { value: "spouse", label: "Spouse" },
  { value: "sibling", label: "Sibling" },
  { value: "boyfriend", label: "Boyfriend", heart: true },
  { value: "girlfriend", label: "Girlfriend", heart: true },
  { value: "old_friend", label: "Old friend" },
  { value: "new_friend", label: "New friend" },
  { value: "friend", label: "Friend" },
  { value: "neighbor", label: "Neighbor" },
  { value: "designer", label: "Designer" },
  { value: "other", label: "Other…" },
];

export const TRADE_PRO_TEAMMATE_OPTIONS: { value: TradeProTeammateChip; label: string }[] = [
  { value: "plumbing", label: "Plumbing" },
  { value: "carpentry", label: "Carpentry" },
  { value: "electrical", label: "Electrical" },
  { value: "painting", label: "Painting" },
  { value: "roofing", label: "Roofing" },
  { value: "landscaping", label: "Landscaping" },
  { value: "other", label: "Other…" },
];

export const FACILITY_TEAMMATE_OPTIONS: { value: FacilityTeammateChip; label: string }[] = [
  { value: "maintenance", label: "Maintenance" },
  { value: "housekeeping", label: "Housekeeping" },
  { value: "gardener", label: "Gardener" },
  { value: "security", label: "Security" },
  { value: "concierge", label: "Concierge" },
  { value: "office", label: "Office" },
  { value: "other", label: "Other…" },
];

const onSiteByValue = new Map(ON_SITE_IDENTITY_OPTIONS.map((o) => [o.value, o]));
const collabByValue = new Map(COLLABORATOR_CHIP_OPTIONS.map((o) => [o.value, o]));
const tradeProTeammateByValue = new Map(TRADE_PRO_TEAMMATE_OPTIONS.map((o) => [o.value, o]));
const facilityTeammateByValue = new Map(FACILITY_TEAMMATE_OPTIONS.map((o) => [o.value, o]));

/** Resolve the display label for an on-site identity, honoring `Other…` free text. */
export function onSiteIdentityLabel(
  value: string | null | undefined,
  other: string | null | undefined,
): string | null {
  if (!value) return null;
  if (value === "other") return (other ?? "").trim() || "Other";
  return onSiteByValue.get(value as OnSiteIdentity)?.label ?? null;
}

/** Resolve the display label for a collaborator chip, honoring `Other…` free text. */
export function collaboratorChipLabel(
  value: string | null | undefined,
  other: string | null | undefined,
): { label: string; heart: boolean } | null {
  if (!value) return null;
  if (value === "other") {
    const t = (other ?? "").trim();
    return t ? { label: t, heart: false } : { label: "Other", heart: false };
  }
  const opt = collabByValue.get(value as CollaboratorChip);
  return opt ? { label: opt.label, heart: !!opt.heart } : null;
}

/** Resolve the display label for a teammate chip from a company team seat. */
export function teammateChipLabel(
  companyKind: string | null | undefined,
  value: string | null | undefined,
  other: string | null | undefined,
): string | null {
  if (!value) return null;
  if (value === "other") return (other ?? "").trim() || "Other";
  if (companyKind === "trade_pro") {
    return tradeProTeammateByValue.get(value as TradeProTeammateChip)?.label ?? value;
  }
  if (companyKind === "facilities") {
    return facilityTeammateByValue.get(value as FacilityTeammateChip)?.label ?? value;
  }
  return value;
}

export interface RenderableTagFields {
  /** roleContext from /relationships, used as a fallback when no
   *  serviceTitle is present (e.g. collaborator rows or pre-#502 data). */
  roleContext?: string | null;
  serviceTitle?: string | null;
  onSiteIdentity?: string | null;
  onSiteIdentityOther?: string | null;
  chip?: string | null;
  chipOther?: string | null;
}

/**
 * #547 — shared per-skin bucketing for the People list surfaces.
 *
 * `my-team.tsx` and the `PeopleModal` shown from the profile flow
 * both render the same roster, so they share this helper to stay in
 * lock step on bucket shape and naming.  Keep this in sync with the
 * layout doc described at the top of `app/(tabs)/my-team.tsx`.
 */
export type CompanyKind = "trade_pro" | "facilities" | null;

export type PeopleBuckets<T> =
  | { kind: "trade_pro"; clients: T[]; outsideServices: T[]; friends: T[] }
  | { kind: "facilities"; friends: T[] }
  | { kind: "home"; tradePros: T[]; friends: T[] };

// `classification` / `cadence` aren't yet in the generated
// RelationshipPerson type but are present on the wire (#502 / #504),
// so accept any record-shaped row and read those fields loosely.
const isOutsideService = (p: unknown) =>
  (p as { classification?: string | null }).classification === "outside_service_provider";

export function bucketRelationships<T>(
  rels: { core?: T[]; clients?: T[]; collaborators?: T[] } | null | undefined,
  companyKind: CompanyKind,
  filter: (p: T) => boolean = () => true,
): PeopleBuckets<T> {
  const core = (rels?.core ?? []).filter(filter);
  const clients = (rels?.clients ?? []).filter(filter);
  const collabs = (rels?.collaborators ?? []).filter(filter);

  if (companyKind === "trade_pro") {
    const outside = [...core.filter(isOutsideService), ...collabs.filter(isOutsideService)];
    const friends = collabs.filter((p) => !isOutsideService(p));
    // Any non-outside core rows are also pros that this Trade Pro
    // works with — fold them into the same Outside Services bucket
    // so nothing slips through the cracks.
    const otherCore = core.filter((p) => !isOutsideService(p));
    return {
      kind: "trade_pro",
      clients,
      outsideServices: [...outside, ...otherCore],
      friends,
    };
  }

  if (companyKind === "facilities") {
    // Outside Services for Facility Managers lives on the left
    // lower-nav tab, so My Team / People here only carry Friends &
    // Collaborators alongside the Facility Teammates roster.
    const friends = collabs.filter((p) => !isOutsideService(p));
    return { kind: "facilities", friends };
  }

  // Homeowner default — every "core" row is a Trade Pro the
  // homeowner has hired; everything else is a friend or collaborator.
  return { kind: "home", tradePros: core, friends: collabs };
}

export function splitByCadence<T>(rows: T[]): { occasional: T[]; recurring: T[] } {
  const isRecurring = (p: T) =>
    (p as { cadence?: string | null }).cadence === "recurring";
  const recurring = rows.filter(isRecurring);
  const occasional = rows.filter((p) => !isRecurring(p));
  return { occasional, recurring };
}

/**
 * Compose the `Label · Chip` line shown directly under a person's
 * name. Returns null if no tag info is available — callers should fall
 * back to roleContext / username in that case.
 *
 * Resolution order:
 *   1. Trade Pro chip (on-site identity) → `serviceTitle · onSiteIdentity`
 *   2. Collaborator chip → `roleContext · chip` (chip wins as label
 *      when no roleContext is present).
 *   3. roleContext only.
 */
export function composeLabelChipLine(
  fields: RenderableTagFields,
): { label: string | null; chip: string | null; chipHeart: boolean } {
  const onsite = onSiteIdentityLabel(fields.onSiteIdentity, fields.onSiteIdentityOther);
  const collab = collaboratorChipLabel(fields.chip, fields.chipOther);
  const role = (fields.roleContext ?? "").trim() || null;
  const service = (fields.serviceTitle ?? "").trim() || null;

  if (onsite || service) {
    return { label: service ?? role, chip: onsite, chipHeart: false };
  }
  if (collab) {
    return { label: role, chip: collab.label, chipHeart: collab.heart };
  }
  return { label: role, chip: null, chipHeart: false };
}
