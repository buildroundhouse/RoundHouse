import React from "react";
import { useRouter } from "expo-router";
import { EntryStep } from "@/components/EntryStep";
import { PROPERTY_TYPES } from "@/lib/entry-intake";
export default function PropertyTypeScreen() {
  const router = useRouter();
  return (
    <EntryStep
      step={2}
      title="What type of property?"
      intro="Choose the property type."
      choices={PROPERTY_TYPES}
      onSelect={(propertyType) =>
        router.push({
          pathname: "/(onboarding)/entry-role",
          params: { entity: "property", propertyType },
        })
      }
    />
  );
}
