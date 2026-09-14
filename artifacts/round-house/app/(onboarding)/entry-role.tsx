import React from "react";
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import { EntryStep } from "@/components/EntryStep";
import {
  entryDetailsRoute,
  readEntrySelection,
  relationshipChoices,
  type EntryParams,
} from "@/lib/entry-intake";
export default function EntryRoleScreen() {
  const router = useRouter(),
    params = useLocalSearchParams<EntryParams>();
  const validated = readEntrySelection({ ...params, relationship: "owner" });
  if (!validated) return <Redirect href="/(onboarding)/entry" />;
  return (
    <EntryStep
      step={3}
      title={`How are you connected to this ${validated.entity}?`}
      intro={
        validated.entity === "property"
          ? `${validated.propertyType === "commercial" ? "Commercial" : "Residential"} property`
          : validated.businessType!
      }
      choices={relationshipChoices(validated.entity)}
      onSelect={(relationship) => {
        const selection = readEntrySelection({ ...validated, relationship })!;
        router.push({
          pathname: entryDetailsRoute(selection),
          params: { ...selection },
        });
      }}
    />
  );
}
