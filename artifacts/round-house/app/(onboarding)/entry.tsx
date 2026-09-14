import React from "react";
import { useRouter } from "expo-router";
import { EntryStep } from "@/components/EntryStep";
import { ENTRY_CHOICES } from "@/lib/entry-intake";
export default function EntryScreen() {
  const router = useRouter();
  return (
    <EntryStep
      step={1}
      title="Property or Business?"
      intro="What would you like to add or connect with?"
      choices={ENTRY_CHOICES}
      onSelect={(entity) =>
        router.push(
          entity === "property"
            ? "/(onboarding)/entry-property-type"
            : "/(onboarding)/entry-business-type",
        )
      }
    />
  );
}
