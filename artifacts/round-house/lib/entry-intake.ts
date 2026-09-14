// Intake describes the space first. Relationships are not standalone account types.
export type EntryEntityKind = "property" | "business";
export type PropertyType = "residential" | "commercial";
export type EntryRelationship = "owner" | "manager" | "team_member" | "viewer";
export type EntrySelection = {
  entity: EntryEntityKind;
  propertyType?: PropertyType;
  businessType?: string;
  relationship: EntryRelationship;
};
export type EntryParams = {
  entity?: string;
  propertyType?: string;
  businessType?: string;
  relationship?: string;
};
export type EntryChoice = { value: string; label: string; description: string };
export const ENTRY_CHOICES: EntryChoice[] = [
  {
    value: "property",
    label: "Property",
    description: "A residential or commercial property.",
  },
  {
    value: "business",
    label: "Business",
    description: "A trade or business and its team.",
  },
];
export const PROPERTY_TYPES: EntryChoice[] = [
  {
    value: "residential",
    label: "Residential",
    description: "A home or residential property.",
  },
  {
    value: "commercial",
    label: "Commercial",
    description: "A commercial property or facility.",
  },
];
export function relationshipChoices(entity: EntryEntityKind): EntryChoice[] {
  return [
    { value: "owner", label: "Owner", description: `I own this ${entity}.` },
    {
      value: "manager",
      label: "Manager",
      description: `I manage this ${entity}.`,
    },
    {
      value: "team_member",
      label:
        entity === "property" ? "Home Team Member" : "Business Team Member",
      description: "I am part of the team.",
    },
    {
      value: "viewer",
      label: "Viewer",
      description: "I view what has been shared with me.",
    },
  ];
}
export function readEntrySelection(params: EntryParams): EntrySelection | null {
  if (params.entity !== "property" && params.entity !== "business") return null;
  if (
    !relationshipChoices(params.entity).some(
      (c) => c.value === params.relationship,
    )
  )
    return null;
  if (params.entity === "property") {
    if (
      params.propertyType !== "residential" &&
      params.propertyType !== "commercial"
    )
      return null;
    return {
      entity: "property",
      propertyType: params.propertyType,
      relationship: params.relationship as EntryRelationship,
    };
  }
  if (typeof params.businessType !== "string" || !params.businessType.trim())
    return null;
  return {
    entity: "business",
    businessType: params.businessType.trim(),
    relationship: params.relationship as EntryRelationship,
  };
}
export function entryDetailsRoute(selection: EntrySelection) {
  // Joining a space must use approved membership, never provision an owner profile.
  if (selection.relationship !== "owner")
    return "/(onboarding)/entry-access" as const;
  return selection.entity === "business"
    ? ("/(onboarding)/entry-business" as const)
    : ("/(onboarding)/entry-entity" as const);
}
export function entryOwnerMode(
  selection: EntrySelection,
): "home" | "facilities" | "trade_pro" | null {
  if (selection.relationship !== "owner") return null;
  if (selection.entity === "business") return "trade_pro";
  return selection.propertyType === "commercial" ? "facilities" : "home";
}
