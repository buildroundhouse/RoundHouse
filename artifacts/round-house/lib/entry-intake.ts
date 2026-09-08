import type { ComponentProps } from "react";
import type { Feather } from "@expo/vector-icons";

export type EntryPath = "property_owner" | "trade_pro" | "trade_team" | "commercial_pro" | "commercial_team" | "commercial_supplier" | "collaborator";
export type EntryEntityKind = "property" | "business" | "either";
export type EntryChoice = { kind: EntryPath; label: string; description: string; entityKind: EntryEntityKind; icon: ComponentProps<typeof Feather>["name"] };

export const ENTRY_CHOICES: EntryChoice[] = [
  { kind: "property_owner", label: "Property Owner", description: "I own or manage a property.", entityKind: "property", icon: "home" },
  { kind: "trade_pro", label: "Trade Pro", description: "I own or operate a trade business.", entityKind: "business", icon: "tool" },
  { kind: "trade_team", label: "Trade Team Member", description: "I work with a trade business.", entityKind: "business", icon: "users" },
  { kind: "commercial_pro", label: "Commercial Pro", description: "I own or manage a commercial operation.", entityKind: "business", icon: "briefcase" },
  { kind: "commercial_team", label: "Commercial Team Member", description: "I work with a commercial operation.", entityKind: "business", icon: "user-check" },
  { kind: "commercial_supplier", label: "Commercial Supplier", description: "I supply goods or recurring services.", entityKind: "business", icon: "truck" },
  { kind: "collaborator", label: "Collaborator", description: "I am helping with a property or business.", entityKind: "either", icon: "link" },
];

export const getEntryChoice = (kind?: string) => ENTRY_CHOICES.find((choice) => choice.kind === kind) ?? null;
