/**
 * Task #502 — universal label + chip pattern.
 *
 * Server-side validation + normalization for the new tag fields stored
 * on `user_connections`:
 *   - classification (Worker / Outside service provider) — picked by
 *     the Homeowner / Facility Manager when classifying a Trade Pro.
 *   - serviceTitle — picked by the Trade Pro from their own Services
 *     chips. Becomes the *label* shown under the pro's name.
 *   - onSiteIdentity (+ onSiteIdentityOther) — picked by the Trade Pro;
 *     becomes the *chip* shown directly under the label.
 *   - chip (+ chipOther) — collaborator's own chip describing their
 *     relationship to the viewer.
 */
import type {
  ConnectionClassification,
  ConnectionCadence,
  ConnectionOnSiteIdentity,
  ConnectionCollaboratorChip,
} from "@workspace/db";

export const CONNECTION_CLASSIFICATIONS: ConnectionClassification[] = [
  "worker",
  "outside_service_provider",
];

export const CONNECTION_CADENCES: ConnectionCadence[] = [
  "occasional",
  "recurring",
];

export const ON_SITE_IDENTITIES: ConnectionOnSiteIdentity[] = [
  "contractor",
  "handyman",
  "specialist",
  "technician",
  "vendor",
  "other",
];

export const COLLABORATOR_CHIPS: ConnectionCollaboratorChip[] = [
  "mom",
  "dad",
  "spouse",
  "sibling",
  "boyfriend",
  "girlfriend",
  "old_friend",
  "new_friend",
  "friend",
  "neighbor",
  "designer",
  "other",
];

export const TRADE_PRO_TEAMMATE_CHIPS = [
  "plumbing",
  "carpentry",
  "electrical",
  "painting",
  "roofing",
  "landscaping",
  "other",
] as const;

export const FACILITY_TEAMMATE_CHIPS = [
  "maintenance",
  "housekeeping",
  "gardener",
  "security",
  "concierge",
  "office",
  "other",
] as const;

export type TradeProTeammateChip = (typeof TRADE_PRO_TEAMMATE_CHIPS)[number];
export type FacilityTeammateChip = (typeof FACILITY_TEAMMATE_CHIPS)[number];

function trim(v: unknown, max = 200): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  if (t.length === 0) return null;
  return t.slice(0, max);
}

export interface ParsedClientTagFields {
  classification?: ConnectionClassification | null;
  cadence?: ConnectionCadence | null;
}

export interface ParsedProTagFields {
  serviceTitle?: string | null;
  onSiteIdentity?: ConnectionOnSiteIdentity | null;
  onSiteIdentityOther?: string | null;
}

export interface ParsedCollabTagFields {
  chip?: ConnectionCollaboratorChip | null;
  chipOther?: string | null;
}

export type ParsedConnectionTagFields = ParsedClientTagFields &
  ParsedProTagFields &
  ParsedCollabTagFields;

/**
 * Parse and validate the tag-fields subset of a request body. Returns
 * the parsed values when every supplied field is valid, or an error
 * string. Fields that are absent from the body remain absent in the
 * output (so caller can distinguish "leave alone" from "clear").
 */
export function parseConnectionTagFields(
  body: Record<string, unknown> | null | undefined,
): { ok: true; values: ParsedConnectionTagFields } | { ok: false; error: string } {
  const out: ParsedConnectionTagFields = {};
  const b = body ?? {};

  if ("classification" in b) {
    const v = b.classification;
    if (v === null || v === "") {
      out.classification = null;
    } else if (
      typeof v === "string" &&
      (CONNECTION_CLASSIFICATIONS as string[]).includes(v)
    ) {
      out.classification = v as ConnectionClassification;
    } else {
      return { ok: false, error: "Invalid classification" };
    }
  }

  if ("cadence" in b) {
    const v = b.cadence;
    if (v === null || v === "") {
      out.cadence = null;
    } else if (
      typeof v === "string" &&
      (CONNECTION_CADENCES as string[]).includes(v)
    ) {
      out.cadence = v as ConnectionCadence;
    } else {
      return { ok: false, error: "Invalid cadence" };
    }
  }

  if ("serviceTitle" in b) {
    const t = trim(b.serviceTitle);
    if (t !== undefined) out.serviceTitle = t;
  }

  if ("onSiteIdentity" in b) {
    const v = b.onSiteIdentity;
    if (v === null || v === "") {
      out.onSiteIdentity = null;
    } else if (
      typeof v === "string" &&
      (ON_SITE_IDENTITIES as string[]).includes(v)
    ) {
      out.onSiteIdentity = v as ConnectionOnSiteIdentity;
    } else {
      return { ok: false, error: "Invalid onSiteIdentity" };
    }
  }
  if ("onSiteIdentityOther" in b) {
    const t = trim(b.onSiteIdentityOther, 80);
    if (t !== undefined) out.onSiteIdentityOther = t;
  }

  if ("chip" in b) {
    const v = b.chip;
    if (v === null || v === "") {
      out.chip = null;
    } else if (
      typeof v === "string" &&
      (COLLABORATOR_CHIPS as string[]).includes(v)
    ) {
      out.chip = v as ConnectionCollaboratorChip;
    } else {
      return { ok: false, error: "Invalid chip" };
    }
  }
  if ("chipOther" in b) {
    const t = trim(b.chipOther, 80);
    if (t !== undefined) out.chipOther = t;
  }

  return { ok: true, values: out };
}

/**
 * Validate a teammate chip against the curated list for the company
 * skin's kind. Returns null if the chip is valid (or absent), or an
 * error string otherwise. "other" plus any chipOther free text is
 * always allowed.
 */
export function parseTeammateChipFields(
  body: Record<string, unknown> | null | undefined,
  companyKind: string | null,
): { ok: true; chip?: string | null; chipOther?: string | null } | { ok: false; error: string } {
  const b = body ?? {};
  const out: { chip?: string | null; chipOther?: string | null } = {};

  if ("chip" in b) {
    const v = b.chip;
    if (v === null || v === "") {
      out.chip = null;
    } else if (typeof v !== "string") {
      return { ok: false, error: "Invalid chip" };
    } else {
      const allowed: readonly string[] | null =
        companyKind === "trade_pro"
          ? TRADE_PRO_TEAMMATE_CHIPS
          : companyKind === "facilities"
            ? FACILITY_TEAMMATE_CHIPS
            : null;
      if (allowed && !allowed.includes(v)) {
        return { ok: false, error: "Invalid chip for this team" };
      }
      out.chip = v;
    }
  }
  if ("chipOther" in b) {
    const t = trim(b.chipOther, 80);
    if (t !== undefined) out.chipOther = t;
  }
  return { ok: true, ...out };
}
