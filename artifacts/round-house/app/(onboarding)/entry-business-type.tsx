import React, { useState } from "react";
import { Pressable, Text, TextInput } from "react-native";
import { useRouter } from "expo-router";
import { EntryStep } from "@/components/EntryStep";
import { BUSINESS_TYPES } from "@/lib/entry-business-profile";
import { useColors } from "@/hooks/useColors";
export default function BusinessTypeScreen() {
  const router = useRouter(),
    colors = useColors();
  const [search, setSearch] = useState("");
  const types: string[] = BUSINESS_TYPES.filter((type) =>
    type.toLowerCase().includes(search.trim().toLowerCase()),
  );
  if (
    search.trim() &&
    !BUSINESS_TYPES.some(
      (type) => type.toLowerCase() === search.trim().toLowerCase(),
    )
  )
    types.push(search.trim());
  return (
    <EntryStep
      step={2}
      title="What type of business?"
      intro="Choose your trade or business type."
      choices={[]}
    >
      <TextInput
        accessibilityLabel="Search business types"
        value={search}
        onChangeText={setSearch}
        placeholder="Search or enter a business type"
        placeholderTextColor={colors.mutedForeground}
        style={{
          color: colors.foreground,
          borderColor: colors.border,
          borderWidth: 1,
          borderRadius: 12,
          padding: 16,
          minHeight: 52,
        }}
      />
      {types.map((type) => (
        <BusinessChoice
          key={type}
          type={type}
          onPress={() =>
            router.push({
              pathname: "/(onboarding)/entry-role",
              params: { entity: "business", businessType: type },
            })
          }
        />
      ))}
    </EntryStep>
  );
}
function BusinessChoice({
  type,
  onPress,
}: {
  type: string;
  onPress: () => void;
}) {
  const colors = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={{
        minHeight: 52,
        padding: 16,
        borderRadius: 14,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.card,
      }}
    >
      <Text style={{ color: colors.foreground, fontSize: 16 }}>{type}</Text>
    </Pressable>
  );
}
