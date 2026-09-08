export type EntryPath =
  | "property_owner"
  | "trade_pro"
  | "trade_team"
  | "commercial_pro"
  | "commercial_team"
  | "commercial_supplier"
  | "collaborator";

export type EntryEntityKind = "property" | "business";

export type EntryChoice = {
  kind: EntryPath;
  label: string;
  description: string;
  tagline: string;
  icon: "home" | "tool" | "grid" | "truck" | "users";
  entityKind: EntryEntityKind;
};

/**
 * Roundhouse-owned entry vocabulary.
 *
 * These choices describe the relationship the person is trying to establish.
 * They are NOT permanent user types and they deliberately do not use the
 * legacy user_modes model.
 *
 * The next step for every choice is entity resolution: search first, then
 * create only when the real-world Property or Business does not already
 * exist. Creation never proves ownership; it can establish stewardship until
 * an ownership claim is accepted or verified.
 */
export const ENTRY_CHOICES: EntryChoice[] = [
  {
    kind: "property_owner",
    label: "Property Owner",
    description: "I own or manage a home or property.",
    tagline: "Find or create the property",
    icon: "home",
    entityKind: "property",
  },
  {
    kind: "trade_pro",
    label: "Trade Pro",
    description: "I run or represent a trade business that works on properties.",
    tagline: "Find or create the business",
    icon: "tool",
    entityKind: "business",
  },
  {
    kind: "trade_team",
    label: "Trade Team Member",
    description: "I work for or with a Trade Pro business.",
    tagline: "Find the business you work with",
    icon: "tool",
    entityKind: "business",
  },
  {
    kind: "commercial_pro",
    label: "Commercial Pro",
    description: "I manage commercial property, facilities, or commercial work.",
    tagline: "Find or create the business",
    icon: "grid",
    entityKind: "business",
  },
  {
    kind: "commercial_team",
    label: "Commercial Team Member",
    description: "I work on a commercial or facilities team.",
    tagline: "Find the business or facility team",
    icon: "grid",
    entityKind: "business",
  },
  {
    kind: "commercial_supplier",
    label: "Commercial Supplier",
    description: "I provide recurring goods or services such as linens, water, uniforms, or deliveries.",
    tagline: "Find or create the supplier business",
    icon: "truck",
    entityKind: "business",
  },
  {
    kind: "collaborator",
    label: "Collaborator",
    description: "I help with work but I am not claiming ownership of the property or business.",
    tagline: "Connect through a property or business",
    icon: "users",
    entityKind: "property",
  },
];

export function getEntryChoice(kind: string | undefined): EntryChoice | null {
  return ENTRY_CHOICES.find((choice) => choice.kind === kind) ?? null;
}
