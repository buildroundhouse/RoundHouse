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
import { MODE_LABELS, MODE_TAGLINES, COLLAB_MODES } from "@/lib/intake-schemas";
import { useProfile } from "@/lib/profile";

type PickerEntry =
  | { kind: UserModeKind; description: string; icon: keyof typeof Feather.glyphMap; sentinel?: false }
  | { kind: "__collab__"; description: string; icon: keyof typeof Feather.glyphMap; sentinel: true };

// Canonical order shown in every account picker / switcher across the
// app. Mirrors USER_MODE_KIND_ORDER in @workspace/api-zod.
const ENTRIES: PickerEntry[] = [
  { kind: "home", description: "I run a place I care about. Track work, history, people.", icon: "home" },
  { kind: "home_teammate", description: "I help out at someone's home.", icon: "home" },
  { kind: "trade_pro", description: "I do the work. Run my day, log jobs, manage clients.", icon: "tool" },
  { kind: "trade_pro_teammate", description: "I work at a Trade Pro business.", icon: "tool" },
  { kind: "facilities", description: "I keep operations running. Work orders, team, standards.", icon: "grid" },
  { kind: "facilities_teammate", description: "I work at a commercial facility.", icon: "grid" },
  { kind: "__collab__", description: "I collaborate with a Trade Pro or Facilities team.", icon: "users", sentinel: true },
];

export default function ModePickerScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { modes, refetchModes, refetchProfile } = useProfile();
  const activate = useActivateMode();
  const completeIntake = useCompleteModeIntake();
  const [picking, setPicking] = useState<string | null>(null);
  const [showCollab, setShowCollab] = useState(false);
  const [skipping, setSkipping] = useState(false);
  const [error, setError] = useState("");

  // #572: Reframe mode picker as optional. The Collaborator / Friend
  // baseline is auto-provisioned for everyone, so a user who'd rather
  // explore first can skip this step entirely. Confirms once so they
  // know what landing-as-Collaborator means; they can still add a
  // primary hat later from Profile → Add another hat.
  const handleSkip = () => {
    Alert.alert(
      "Skip for now?",
      "You'll land in your Collaborator / Friend profile — a viewer-style account with social features. " +
        "You can add a Trade Pro, Home, or Facilities hat anytime from your Profile.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Skip",
          style: "default",
          onPress: async () => {
            setSkipping(true);
            setError("");
            try {
              const created = await activate.mutateAsync({ data: { kind: "collab" } });
              // Collaborator / Friend has no required intake fields, so
              // mark it complete immediately so the profile gate stops
              // bouncing the user back to /(onboarding).
              await completeIntake.mutateAsync({
                modeId: created.id,
                data: { intakeData: {} },
              });
              await refetchModes();
              await refetchProfile();
              router.replace("/(tabs)");
            } catch (e) {
              setError(e instanceof Error ? e.message : "Couldn't skip — try picking a hat.");
              setSkipping(false);
            }
          },
        },
      ],
    );
  };

  const activatedKinds = new Set(modes.map((m) => m.kind));
  const allCollabActivated =
    activatedKinds.has("trade_pro_collab") && activatedKinds.has("facilities_collab");

  const handlePick = async (kind: UserModeKind) => {
    setPicking(kind);
    setError("");
    try {
      const created = await activate.mutateAsync({ data: { kind } });
      await refetchModes();
      router.replace({ pathname: "/(onboarding)/intake", params: { modeId: String(created.id), kind } });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't activate that mode.");
      setPicking(null);
    }
  };

  if (showCollab) {
    return (
      <View style={[styles.root, { backgroundColor: colors.background, paddingTop: insets.top + 24 }]}>
        <ScrollView contentContainerStyle={styles.scroll}>
          <Pressable onPress={() => setShowCollab(false)} style={styles.back}>
            <Feather name="arrow-left" size={20} color={colors.foreground} />
            <Text style={[styles.backText, { color: colors.foreground }]}>Back</Text>
          </Pressable>
          <Text style={[styles.title, { color: colors.foreground }]}>What kind of collaborator?</Text>
          <Text style={[styles.intro, { color: colors.mutedForeground }]}>
            We'll set up the right tools for the team you work in.
          </Text>

          {COLLAB_MODES.map((kind) => (
            <ModeTile
              key={kind}
              icon={kind === "trade_pro_collab" ? "tool" : "grid"}
              description={
                kind === "trade_pro_collab"
                  ? "I work under a Trade Pro on jobs."
                  : "I work inside a facilities team."
              }
              tagline={MODE_TAGLINES[kind]}
              label={MODE_LABELS[kind]}
              onPress={() => handlePick(kind)}
              disabled={activatedKinds.has(kind)}
              loading={picking === kind}
            />
          ))}

          {error ? <Text style={[styles.error, { color: colors.destructive }]}>{error}</Text> : null}
        </ScrollView>
      </View>
    );
  }

  // #572: the auto-provisioned Collaborator / Friend baseline doesn't
  // count as a "real" hat — users still need to pick one (or skip) on
  // their first visit. Treat the picker as "first run" until they've
  // activated something other than the baseline collab.
  const workingModes = modes.filter((m) => m.kind !== "collab");
  const hasExistingModes = workingModes.length > 0;
  const title = hasExistingModes ? "Add another hat" : "Pick your first hat";
  const intro = hasExistingModes
    ? "Wear more than one hat in Roundhouse. Pick the next one to set up."
    : "We all wear different hats. Pick the one that fits right now — or skip and just look around.";

  return (
    <View style={[styles.root, { backgroundColor: colors.background, paddingTop: insets.top + 16 }]}>
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

        {ENTRIES.map((p) => {
          if (p.sentinel) {
            return (
              <ModeTile
                key="__collab__"
                icon={p.icon}
                description={p.description}
                tagline="Work assigned by someone else"
                label="Collaborator"
                onPress={() => setShowCollab(true)}
                disabled={allCollabActivated}
                disabledLabel="All collaborator modes activated"
                loading={false}
              />
            );
          }
          return (
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
          );
        })}

        {!hasExistingModes ? (
          <Pressable
            onPress={handleSkip}
            disabled={skipping}
            style={({ pressed }) => [
              styles.skipBtn,
              { borderColor: colors.border, opacity: pressed || skipping ? 0.7 : 1 },
            ]}
            accessibilityRole="button"
            accessibilityLabel="Skip mode picker for now"
          >
            <Text style={[styles.skipText, { color: colors.mutedForeground }]}>
              {skipping ? "Setting up…" : "Skip for now — I'll just look around"}
            </Text>
          </Pressable>
        ) : null}

        {error ? <Text style={[styles.error, { color: colors.destructive }]}>{error}</Text> : null}
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
  disabledLabel,
}: {
  icon: keyof typeof Feather.glyphMap;
  description: string;
  tagline: string;
  label: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  disabledLabel?: string;
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
          {disabled ? disabledLabel ?? "Already activated" : description}
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
  back: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 4 },
  backText: { fontSize: 14, fontFamily: "Inter_500Medium" },
  title: { fontSize: 26, fontFamily: "Inter_700Bold", marginTop: 4 },
  intro: { fontSize: 14, fontFamily: "Inter_400Regular", lineHeight: 20, marginBottom: 12 },
  tile: {
    borderWidth: 1,
    borderRadius: 16,
    padding: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
  },
  tileIcon: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  tileTitle: { fontSize: 16, fontFamily: "Inter_700Bold" },
  tileTagline: { fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 18, marginTop: 2 },
  tileFeel: { fontSize: 12, fontFamily: "Inter_500Medium", marginTop: 4, fontStyle: "italic" },
  error: { fontSize: 13, fontFamily: "Inter_400Regular", textAlign: "center", marginTop: 8 },
  skipBtn: {
    marginTop: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    alignItems: "center",
  },
  skipText: { fontSize: 14, fontFamily: "Inter_500Medium" },
  sectionHeading: {
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginTop: 16,
    marginBottom: 4,
  },
});
