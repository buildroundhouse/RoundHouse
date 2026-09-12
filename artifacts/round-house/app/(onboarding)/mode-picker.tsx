import React, { useState } from "react";
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import {
  useActivateMode,
  useCompleteModeIntake,
  type UserModeKind,
} from "@workspace/api-client-react";
import { MODE_LABELS, MODE_TAGLINES } from "@/lib/intake-schemas";
import { useProfile } from "@/lib/profile";

type PickerEntry = {
  kind: UserModeKind;
  description: string;
  icon: keyof typeof Feather.glyphMap;
};

/**
 * Product-facing operating roles. The historical `collab` storage kind is not
 * a selectable operating role; it backs the neutral Viewer profile used when
 * a person has not yet joined a Home, Facility, or Business context.
 */
const ENTRIES: PickerEntry[] = [
  {
    kind: "home",
    description: "I care for a home or property and want its work and history in one place.",
    icon: "home",
  },
  {
    kind: "home_teammate",
    description: "I help care for a home as part of its Home Team.",
    icon: "home",
  },
  {
    kind: "trade_pro",
    description: "I perform trade work and manage jobs, Properties, and clients.",
    icon: "tool",
  },
  {
    kind: "trade_pro_teammate",
    description: "I work as part of a Trade Business team.",
    icon: "tool",
  },
  {
    kind: "facilities",
    description: "I manage commercial Properties, operations, standards, and work.",
    icon: "grid",
  },
  {
    kind: "facilities_teammate",
    description: "I work as part of a Commercial Management team.",
    icon: "grid",
  },
];

export default function ModePickerScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { modes, refetchModes, refetchProfile } = useProfile();
  const activate = useActivateMode();
  const completeIntake = useCompleteModeIntake();
  const [picking, setPicking] = useState<string | null>(null);
  const [skipping, setSkipping] = useState(false);
  const [error, setError] = useState("");

  /**
   * Skip leaves the person with the neutral Viewer profile. Viewer is not an
   * Entity relationship by itself: actual view access is granted later through
   * a specific Residential Property or Commercial Facility invitation.
   *
   * `collab` remains the historical storage key until the data migration is
   * complete, but that word is never shown to the person.
   */
  const handleSkip = () => {
    Alert.alert(
      "Use a Viewer profile for now?",
      "You'll enter Roundhouse with a neutral view-only profile. A Home or Facility must invite you before you can view its private information. You can add another Role anytime from Profile.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Continue as Viewer",
          style: "default",
          onPress: async () => {
            setSkipping(true);
            setError("");
            try {
              const created = await activate.mutateAsync({ data: { kind: "collab" } });
              await completeIntake.mutateAsync({
                modeId: created.id,
                data: { intakeData: {} },
              });
              await refetchModes();
              await refetchProfile();
              router.replace("/(tabs)");
            } catch (e) {
              setError(
                e instanceof Error
                  ? e.message
                  : "Couldn't set up the Viewer profile. Please try again.",
              );
              setSkipping(false);
            }
          },
        },
      ],
    );
  };

  const activatedKinds = new Set(modes.map((m) => m.kind));

  const handlePick = async (kind: UserModeKind) => {
    setPicking(kind);
    setError("");
    try {
      const created = await activate.mutateAsync({ data: { kind } });
      await refetchModes();
      router.replace({
        pathname: "/(onboarding)/intake",
        params: { modeId: String(created.id), kind },
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't activate that Role.");
      setPicking(null);
    }
  };

  // The neutral Viewer baseline does not count as an operational Role for this
  // picker. A person still chooses a Home / Trade / Commercial role when they
  // actually operate through one of those contexts.
  const workingModes = modes.filter(
    (m) =>
      m.kind !== "collab" &&
      m.kind !== "trade_pro_collab" &&
      m.kind !== "facilities_collab",
  );
  const hasExistingModes = workingModes.length > 0;
  const title = hasExistingModes ? "Add another Role" : "How do you use Roundhouse?";
  const intro = hasExistingModes
    ? "Choose another way you legitimately participate."
    : "Choose the Role that fits what you're doing now, or continue with a neutral Viewer profile until a Home or Facility invites you.";

  return (
    <View
      style={[
        styles.root,
        { backgroundColor: colors.background, paddingTop: insets.top + 16 },
      ]}
    >
      {hasExistingModes ? (
        <Pressable
          onPress={() => {
            if (router.canGoBack()) router.back();
            else router.replace("/(tabs)/profile");
          }}
          style={styles.back}
          hitSlop={12}
        >
          <Feather name="chevron-left" size={22} color={colors.foreground} />
          <Text style={[styles.backText, { color: colors.foreground }]}>Profile</Text>
        </Pressable>
      ) : null}

      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={[styles.title, { color: colors.foreground }]}>{title}</Text>
        <Text style={[styles.intro, { color: colors.mutedForeground }]}>{intro}</Text>

        {ENTRIES.map((p) => (
          <ModeTile
            key={p.kind}
            icon={p.icon}
            description={p.description}
            tagline={MODE_TAGLINES[p.kind]}
            label={MODE_LABELS[p.kind]}
            onPress={() => handlePick(p.kind)}
            disabled={activatedKinds.has(p.kind)}
            loading={picking === p.kind}
          />
        ))}

        {!hasExistingModes ? (
          <Pressable
            onPress={handleSkip}
            disabled={skipping}
            style={({ pressed }) => [
              styles.skipBtn,
              {
                borderColor: colors.border,
                opacity: pressed || skipping ? 0.7 : 1,
              },
            ]}
            accessibilityRole="button"
            accessibilityLabel="Continue with Viewer profile"
          >
            <Feather name="eye" size={17} color={colors.mutedForeground} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.skipTitle, { color: colors.foreground }]}>Viewer</Text>
              <Text style={[styles.skipText, { color: colors.mutedForeground }]}>
                {skipping
                  ? "Setting up…"
                  : "Neutral view-only profile. Private Home or Facility access still requires an invitation."}
              </Text>
            </View>
          </Pressable>
        ) : null}

        {error ? (
          <Text style={[styles.error, { color: colors.destructive }]}>{error}</Text>
        ) : null}
      </ScrollView>
    </View>
  );
}

function ModeTile({
  icon,
  description,
  tagline,
  label,
  onPress,
  disabled,
  loading,
}: {
  icon: keyof typeof Feather.glyphMap;
  description: string;
  tagline: string;
  label: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
}) {
  const colors = useColors();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.tile,
        {
          backgroundColor: colors.card,
          borderColor: colors.border,
          opacity: disabled ? 0.5 : pressed ? 0.85 : 1,
        },
      ]}
    >
      <View style={[styles.tileIcon, { backgroundColor: colors.primary + "22" }]}>
        <Feather name={icon} size={22} color={colors.primary} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.tileTitle, { color: colors.foreground }]}>{label}</Text>
        <Text style={[styles.tileTagline, { color: colors.mutedForeground }]}>
          {disabled ? "Already active" : description}
        </Text>
        <Text style={[styles.tileFeel, { color: colors.primary }]}>{tagline}</Text>
      </View>
      {loading ? (
        <Feather name="loader" size={18} color={colors.mutedForeground} />
      ) : (
        <Feather name="chevron-right" size={20} color={colors.mutedForeground} />
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { paddingHorizontal: 20, paddingBottom: 32, gap: 12 },
  back: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 4,
    paddingHorizontal: 20,
  },
  backText: { fontSize: 14, fontFamily: "Inter_500Medium" },
  title: { fontSize: 26, fontFamily: "Inter_700Bold", marginTop: 4 },
  intro: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    lineHeight: 20,
    marginBottom: 12,
  },
  tile: {
    borderWidth: 1,
    borderRadius: 16,
    padding: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
  },
  tileIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  tileTitle: { fontSize: 16, fontFamily: "Inter_700Bold" },
  tileTagline: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    lineHeight: 18,
    marginTop: 2,
  },
  tileFeel: {
    fontSize: 12,
    fontFamily: "Inter_500Medium",
    marginTop: 4,
    fontStyle: "italic",
  },
  error: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    marginTop: 8,
  },
  skipBtn: {
    marginTop: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  skipTitle: { fontSize: 15, fontFamily: "Inter_700Bold" },
  skipText: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    lineHeight: 17,
    marginTop: 2,
  },
});
