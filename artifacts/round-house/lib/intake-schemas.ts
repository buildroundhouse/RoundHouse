import type { UserModeKind } from "@workspace/api-client-react";

export type IntakeFieldKind =
  | "text"
  | "longtext"
  | "single-select"
  | "multi-select"
  | "zip"
  | "zip-list"
  | "address";

export interface IntakeField {
  key: string;
  label: string;
  helper?: string;
  kind: IntakeFieldKind;
  options?: { value: string; label: string; sublabel?: string }[];
  placeholder?: string;
  required?: boolean;
  maxLength?: number;
  /**
   * Where the value lives. Defaults to "mode" (stored in mode.intakeData).
   * "user" routes the value to the user record (profile-level identity).
   */
  scope?: "mode" | "user";
  /** User profile field name when scope === "user" */
  userField?: "website" | "officePhone" | "cellPhone" | "instagram" | "bio";
}

export interface ModeIntake {
  kind: UserModeKind;
  title: string;
  intro: string;
  homeTitle: string;
  homeSubtitle: string;
  fields: IntakeField[];
}

export const MODE_LABELS: Record<UserModeKind, string> = {
  trade_pro: "Trade Pro",
  home: "Home",
  facilities: "Facility Management",
  trade_pro_teammate: "Trade Teammate",
  facilities_teammate: "Facility Teammate",
  home_teammate: "Home Teammate",
  trade_pro_collab: "Collaborator",
  facilities_collab: "Collaborator",
  collab: "Collaborator",
};

export const MODE_TAGLINES: Record<UserModeKind, string> = {
  trade_pro: "Your jobs, your day, your record",
  home: "Your place, tracked",
  facilities: "Operations and standards",
  trade_pro_teammate: "Teammate at a Trade Pro business",
  facilities_teammate: "Teammate at a commercial facility",
  home_teammate: "Teammate at a home",
  trade_pro_collab: "Work assigned by a pro",
  facilities_collab: "Take work, log progress",
  collab: "Your social presence on Roundhouse",
};

export const MODE_INTAKES: Record<UserModeKind, ModeIntake> = {
  trade_pro: {
    kind: "trade_pro",
    title: "Profile",
    intro: "",
    homeTitle: "Work",
    homeSubtitle: "Your jobs, your day, your record.",
    fields: [
      {
        key: "companyName",
        label: "Business name",
        kind: "text",
        placeholder: "DMT Design Build",
        required: true,
        maxLength: 80,
      },
      {
        key: "ownerName",
        label: "Owner name",
        helper: "Whose business is this? You can edit if it isn't you.",
        kind: "text",
        placeholder: "Jane Doe",
        required: true,
        maxLength: 80,
      },
      {
        key: "businessEmail",
        label: "Business email",
        kind: "text",
        placeholder: "hello@example.com",
        required: true,
        maxLength: 120,
      },
      {
        key: "businessPhone",
        label: "Business phone",
        kind: "text",
        placeholder: "(555) 123-4567",
        required: true,
        maxLength: 40,
      },
      {
        key: "businessAddress",
        label: "Business address",
        helper: "Used to map your shop or office. Never shown publicly without your say-so.",
        kind: "address",
        placeholder: "123 Main St, Austin, TX",
        required: true,
        maxLength: 200,
      },
      {
        key: "licenseNumber",
        label: "License # (optional)",
        kind: "text",
        placeholder: "TX-1234567",
        maxLength: 80,
      },
      {
        key: "trade",
        label: "Trade",
        kind: "single-select",
        required: true,
        options: [
          { value: "general", label: "General Contractor" },
          { value: "electrician", label: "Electrician" },
          { value: "plumber", label: "Plumber" },
          { value: "hvac", label: "HVAC" },
          { value: "carpenter", label: "Carpenter" },
          { value: "painter", label: "Painter" },
          { value: "landscaper", label: "Landscaper" },
          { value: "cleaner", label: "Cleaner" },
          { value: "handyman", label: "Handyman" },
          { value: "other", label: "Other" },
        ],
      },
      {
        key: "experience",
        label: "Experience",
        kind: "single-select",
        required: true,
        options: [
          { value: "<2", label: "<2", sublabel: "years" },
          { value: "2-5", label: "2–5", sublabel: "years" },
          { value: "5-10", label: "5–10", sublabel: "years" },
          { value: "10+", label: "10+", sublabel: "years" },
        ],
      },
      {
        key: "region",
        label: "Service Area",
        kind: "text",
        placeholder: "Austin, TX",
        required: true,
        maxLength: 80,
      },
      {
        key: "primaryZip",
        label: "Primary ZIP",
        helper: "Your home base — the 5-digit ZIP we'll match you on.",
        kind: "zip",
        placeholder: "78701",
        required: true,
        maxLength: 5,
      },
      {
        key: "streetAddress",
        label: "Street address (optional)",
        helper: "Helps us pin you precisely on the map. Never shown publicly.",
        kind: "text",
        placeholder: "123 Main St",
        maxLength: 120,
      },
      {
        key: "additionalZips",
        label: "Other ZIPs you serve",
        helper: "Tap nearby ZIPs to add them, or enter your own.",
        kind: "zip-list",
      },
      {
        key: "website",
        label: "Website (optional)",
        kind: "text",
        placeholder: "https://",
        maxLength: 200,
      },
      {
        key: "instagram",
        label: "Instagram (optional)",
        kind: "text",
        placeholder: "@yourhandle",
        maxLength: 80,
      },
    ],
  },

  home: {
    kind: "home",
    title: "Profile",
    intro: "",
    homeTitle: "Home base",
    homeSubtitle: "Your places, your people, your record.",
    fields: [
      {
        key: "placeName",
        label: "Property",
        kind: "text",
        placeholder: "The river house",
        required: true,
        maxLength: 60,
      },
      {
        key: "neighborhood",
        label: "Neighborhood",
        kind: "text",
        placeholder: "South Austin, Mueller",
        maxLength: 80,
      },
      {
        key: "placeAddress",
        label: "Street address (optional)",
        helper: "Helps with mapping, deals nearby, and matching service-area pros. Never shown publicly.",
        kind: "address",
        placeholder: "123 Main St, Austin, TX",
        maxLength: 200,
      },
      {
        key: "matters",
        label: "Priorities",
        kind: "multi-select",
        required: true,
        options: [
          { value: "warmth", label: "Warmth" },
          { value: "longevity", label: "Longevity" },
          { value: "design", label: "Design" },
          { value: "safety", label: "Safety" },
          { value: "calm", label: "Calm" },
          { value: "garden", label: "Garden" },
          { value: "memory", label: "Memory" },
        ],
      },
    ],
  },

  facilities: {
    kind: "facilities",
    title: "Profile",
    intro: "",
    homeTitle: "Operations",
    homeSubtitle: "Work orders, standards, and your team.",
    fields: [
      {
        key: "operationKind",
        label: "Operation",
        kind: "single-select",
        required: true,
        options: [
          { value: "office", label: "Office" },
          { value: "retail", label: "Retail" },
          { value: "hospitality", label: "Hospitality" },
          { value: "multifamily", label: "Multifamily" },
          { value: "industrial", label: "Industrial" },
          { value: "education", label: "Education" },
          { value: "healthcare", label: "Healthcare" },
          { value: "other", label: "Other" },
        ],
      },
      {
        key: "maintenanceGoals",
        label: "Focus",
        kind: "multi-select",
        required: true,
        options: [
          { value: "preventive", label: "Preventive" },
          { value: "compliance", label: "Compliance" },
          { value: "uptime", label: "Uptime" },
          { value: "cost", label: "Cost" },
          { value: "tenant", label: "Tenant satisfaction" },
          { value: "energy", label: "Energy" },
        ],
      },
      {
        key: "teamSize",
        label: "Team Size",
        kind: "single-select",
        required: true,
        options: [
          { value: "solo", label: "Solo" },
          { value: "2-5", label: "2–5" },
          { value: "6-20", label: "6–20" },
          { value: "20+", label: "20+" },
        ],
      },
    ],
  },

  trade_pro_collab: {
    kind: "trade_pro_collab",
    title: "Profile",
    intro: "",
    homeTitle: "Crew",
    homeSubtitle: "Your assigned work and personal history.",
    fields: [
      {
        key: "experience",
        label: "Experience",
        kind: "single-select",
        required: true,
        options: [
          { value: "<1", label: "<1", sublabel: "year" },
          { value: "1-3", label: "1–3", sublabel: "years" },
          { value: "3-7", label: "3–7", sublabel: "years" },
          { value: "7+", label: "7+", sublabel: "years" },
        ],
      },
      {
        key: "strengths",
        label: "Strengths",
        kind: "multi-select",
        required: true,
        options: [
          { value: "framing", label: "Framing" },
          { value: "finish", label: "Finish carpentry" },
          { value: "electrical", label: "Electrical" },
          { value: "plumbing", label: "Plumbing" },
          { value: "paint", label: "Paint" },
          { value: "demo", label: "Demo" },
          { value: "tile", label: "Tile" },
          { value: "drywall", label: "Drywall" },
          { value: "exterior", label: "Exterior" },
        ],
      },
      {
        key: "growth",
        label: "Goals",
        kind: "longtext",
        required: true,
        maxLength: 240,
      },
    ],
  },

  trade_pro_teammate: {
    kind: "trade_pro_teammate",
    title: "Profile",
    intro: "",
    homeTitle: "Teammate",
    homeSubtitle: "Your work at a Trade Pro business.",
    fields: [
      {
        key: "belongsTo",
        label: "Business",
        helper: "Which Trade Pro business do you work at?",
        kind: "text",
        placeholder: "e.g., DMT Design Build",
        required: true,
        maxLength: 80,
      },
      {
        key: "roleTitle",
        label: "Your role",
        kind: "text",
        placeholder: "e.g., Foreman, Apprentice, Office Manager",
        required: true,
        maxLength: 80,
      },
      {
        key: "displayName",
        label: "Display name",
        kind: "text",
        placeholder: "How your name shows up on this profile",
        required: true,
        maxLength: 60,
      },
    ],
  },

  facilities_teammate: {
    kind: "facilities_teammate",
    title: "Profile",
    intro: "",
    homeTitle: "Teammate",
    homeSubtitle: "Your work at a commercial facility.",
    fields: [
      {
        key: "belongsTo",
        label: "Facility / company",
        helper: "Which commercial facility or company do you work at?",
        kind: "text",
        placeholder: "e.g., Riverside Office Park",
        required: true,
        maxLength: 80,
      },
      {
        key: "roleTitle",
        label: "Your role",
        kind: "text",
        placeholder: "e.g., Maintenance Lead, Property Manager",
        required: true,
        maxLength: 80,
      },
      {
        key: "displayName",
        label: "Display name",
        kind: "text",
        placeholder: "How your name shows up on this profile",
        required: true,
        maxLength: 60,
      },
    ],
  },

  collab: {
    kind: "collab",
    title: "Profile",
    intro: "",
    homeTitle: "You",
    homeSubtitle: "Your social presence on Roundhouse.",
    fields: [],
  },

  home_teammate: {
    kind: "home_teammate",
    title: "Profile",
    intro: "",
    homeTitle: "Teammate",
    homeSubtitle: "Help out at a home.",
    fields: [
      {
        key: "belongsTo",
        label: "Home / household",
        helper: "Which Home account are you helping at?",
        kind: "text",
        placeholder: "e.g., The Smith family",
        required: true,
        maxLength: 80,
      },
      {
        key: "roleTitle",
        label: "Your role at Home",
        kind: "text",
        placeholder: "e.g., Family member, House manager",
        required: true,
        maxLength: 80,
      },
      {
        key: "displayName",
        label: "Display name",
        kind: "text",
        placeholder: "How your name shows up on this profile",
        required: true,
        maxLength: 60,
      },
    ],
  },

  facilities_collab: {
    kind: "facilities_collab",
    title: "Profile",
    intro: "",
    homeTitle: "Worker",
    homeSubtitle: "Clock in, take work, log progress.",
    fields: [
      {
        key: "experience",
        label: "Experience",
        kind: "single-select",
        required: true,
        options: [
          { value: "<1", label: "<1", sublabel: "year" },
          { value: "1-3", label: "1–3", sublabel: "years" },
          { value: "3-7", label: "3–7", sublabel: "years" },
          { value: "7+", label: "7+", sublabel: "years" },
        ],
      },
      {
        key: "strengths",
        label: "Strengths",
        kind: "multi-select",
        required: true,
        options: [
          { value: "general", label: "General maintenance" },
          { value: "electrical", label: "Electrical" },
          { value: "plumbing", label: "Plumbing" },
          { value: "hvac", label: "HVAC" },
          { value: "groundskeeping", label: "Groundskeeping" },
          { value: "janitorial", label: "Janitorial" },
          { value: "security", label: "Security" },
        ],
      },
      {
        key: "learning",
        label: "Goals",
        kind: "longtext",
        required: true,
        maxLength: 240,
      },
    ],
  },
};

export const PRIMARY_MODES: UserModeKind[] = ["trade_pro", "home", "facilities"];
export const COLLAB_MODES: UserModeKind[] = ["trade_pro_collab", "facilities_collab"];

const ZIP_RE = /^\d{5}$/;

export function isFieldComplete(field: IntakeField, value: unknown): boolean {
  if (!field.required) return true;
  if (field.kind === "multi-select") return Array.isArray(value) && value.length > 0;
  if (field.kind === "zip-list") return Array.isArray(value) && value.length > 0;
  if (field.kind === "zip") return typeof value === "string" && ZIP_RE.test(value.trim());
  return typeof value === "string" && value.trim().length > 0;
}

export function isIntakeComplete(intake: ModeIntake, data: Record<string, unknown>): boolean {
  return intake.fields.every((f) => isFieldComplete(f, data[f.key]));
}
