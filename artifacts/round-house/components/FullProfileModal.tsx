import React, { useState } from "react";
import {
  Image,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { useProfile } from "@/lib/profile";
import { MODE_INTAKES, MODE_LABELS, type IntakeField } from "@/lib/intake-schemas";
import { kindLabelForName } from "@/lib/account-display";
import {
  formatOwnerNameForSkin,
  shouldShowSelfPrivacyHint,
} from "@/lib/ownerNameDisplay";
import { useResolvedIntake } from "@/lib/presetChips";
import { resolveStorageUrl } from "@/lib/uploads";
import { EditProfileModal } from "./EditProfileModal";
import type { UserModeKind } from "@workspace/api-client-react";

interface Props {
  visible: boolean;
  onClose: () => void;
}

type ColorScheme = ReturnType<typeof useColors>;

export function FullProfileModal({ visible, onClose }: Props) {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { profile, activeMode, activeOutwardAccount } = useProfile();
  const [editOpen, setEditOpen] = useState(false);

  const intake = useResolvedIntake(
    MODE_INTAKES[activeMode?.kind ?? "home"],
  );

  if (!profile || !activeMode) return null;
  const profileVal = profile;
  const data = (activeMode.intakeData ?? {}) as Record<string, unknown>;
  const avatarUri = resolveStorageUrl(profile.avatarUrl ?? null);
  const isTradePro = activeMode.kind === "trade_pro";
  const companyName =
    isTradePro && typeof data.companyName === "string" && data.companyName.trim().length > 0
      ? data.companyName.trim()
      : null;
  // #620: drop the kind label suffix when the profile name already
  // contains every word of it (e.g. a "My Home" profile + "My Home"
  // label → no suffix; "Beach Home" + "Home" → no suffix). Partial
  // overlaps (e.g. "Smith Home" + "My Home" — missing "my") still render.
  const roleLabel = kindLabelForName(
    profile.name,
    MODE_LABELS[activeMode.kind as UserModeKind],
  );
  // #673 — When the user has flipped the per-skin "show last initial only"
  // privacy toggle on the active outward account, mirror what strangers
  // see on the public profile by shortening the rendered name here as
  // well. The server intentionally does NOT shorten on the self-view of
  // /users/me (the user knows their own identity), so the client applies
  // the rule using the active outward account's flag.
  const displayedName =
    formatOwnerNameForSkin(profile.name, activeOutwardAccount?.lastInitialOnly) ??
    profile.name ??
    "";
  // #694 — When the active skin's "show last initial only" privacy flag
  // is on, the name above is shortened to "First L." so the user can
  // preview what others see (#673). Without context that can read like
  // the app dropped their last name; surface a tiny hint that explains
  // why and links straight to the toggle on the outward-account editor.
  const showPrivacyHint = shouldShowSelfPrivacyHint(
    activeOutwardAccount?.lastInitialOnly,
  );
  const onPrivacyHintPress = () => {
    if (!activeOutwardAccount) return;
    onClose();
    router.push(`/account/edit/${activeOutwardAccount.id}` as never);
  };

  const modeFields = intake.fields.filter((f) => f.scope !== "user" && f.key !== "companyName");
  const userScopedFields = intake.fields.filter((f) => f.scope === "user");

  function valueForUserField(f: IntakeField): string | null {
    if (!f.userField) return null;
    const v = profileVal[f.userField];
    if (typeof v !== "string") return null;
    const t = v.trim();
    return t.length > 0 ? t : null;
  }

  function displayForModeField(f: IntakeField): string | null {
    const raw = data[f.key];
    if (f.kind === "zip-list") {
      // Prefer array (current shape), but fall back to parsing a legacy
      // comma-separated string so older saved profiles still render.
      const zips = Array.isArray(raw)
        ? (raw as unknown[]).filter((z): z is string => typeof z === "string" && /^\d{5}$/.test(z))
        : typeof raw === "string"
          ? raw.split(/[\s,;]+/).map((s) => s.trim()).filter((s) => /^\d{5}$/.test(s))
          : [];
      return zips.length > 0 ? zips.join(", ") : null;
    }
    if (f.kind === "multi-select" && Array.isArray(raw)) {
      const labels = (f.options ?? [])
        .filter((o) => (raw as string[]).includes(o.value))
        .map((o) => o.label);
      return labels.length > 0 ? labels.join(", ") : null;
    }
    if (f.kind === "single-select" && typeof raw === "string") {
      const opt = (f.options ?? []).find((o) => o.value === raw);
      const out = opt?.label ?? raw;
      return out.trim().length > 0 ? out : null;
    }
    if (typeof raw === "string") {
      const t = raw.trim();
      return t.length > 0 ? t : null;
    }
    return null;
  }

  const filledModeRows = modeFields
    .map((f) => ({ f, value: displayForModeField(f) }))
    .filter((r) => r.value !== null) as { f: IntakeField; value: string }[];
  const filledContactRows = userScopedFields
    .map((f) => ({ f, value: valueForUserField(f) }))
    .filter((r) => r.value !== null) as { f: IntakeField; value: string }[];

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={[styles.root, { backgroundColor: colors.background }]}>
        <View
          style={[
            styles.header,
            {
              borderBottomColor: colors.border,
              paddingTop: Platform.OS === "web" ? 24 : insets.top + 8,
            },
          ]}
        >
          <Pressable onPress={onClose} hitSlop={12} style={styles.iconBtn}>
            <Feather name="x" size={22} color={colors.foreground} />
          </Pressable>
          <Text style={[styles.headerTitle, { color: colors.foreground }]}>Profile</Text>
          <Pressable onPress={() => setEditOpen(true)} hitSlop={12} style={styles.iconBtn}>
            <Text style={[styles.editText, { color: colors.primary }]}>Edit</Text>
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 40 }]}>
          <View style={[styles.identityRow, { borderColor: colors.border }]}>
            <View style={[styles.avatar, { backgroundColor: colors.muted }]}>
              {avatarUri ? (
                <Image source={{ uri: avatarUri }} style={styles.avatarImg} />
              ) : (
                <Feather name="user" size={28} color={colors.mutedForeground} />
              )}
            </View>
            <View style={{ flex: 1 }}>
              {companyName ? (
                <Text style={[styles.company, { color: colors.foreground }]} numberOfLines={2}>
                  {companyName}
                </Text>
              ) : null}
              <Text
                testID="full-profile-display-name"
                style={[
                  companyName ? styles.nameSecondary : styles.nameLarge,
                  { color: companyName ? colors.mutedForeground : colors.foreground },
                ]}
                numberOfLines={1}
              >
                {displayedName}
                {roleLabel ? ` · ${roleLabel}` : ""}
              </Text>
              {showPrivacyHint ? (
                <Pressable
                  testID="full-profile-privacy-hint"
                  onPress={onPrivacyHintPress}
                  hitSlop={6}
                  accessibilityRole="link"
                  accessibilityLabel="Privacy: last initial only. Open privacy settings."
                  style={styles.privacyHintRow}
                >
                  <Feather name="lock" size={11} color={colors.mutedForeground} />
                  <Text
                    style={[styles.privacyHintText, { color: colors.mutedForeground }]}
                    numberOfLines={2}
                  >
                    Privacy: last initial only ·{" "}
                    <Text style={{ color: colors.primary }}>Change</Text>
                  </Text>
                </Pressable>
              ) : null}
              {profile.username ? (
                <Text style={[styles.handle, { color: colors.mutedForeground }]} numberOfLines={1}>
                  @{profile.username}
                </Text>
              ) : null}
            </View>
          </View>

          {filledModeRows.length > 0 && (
            <Section title={isTradePro ? "Business" : "Work"} colors={colors}>
              {filledModeRows.map(({ f, value }) => (
                <Row key={f.key} label={f.label} value={value} colors={colors} />
              ))}
            </Section>
          )}

          {filledContactRows.length > 0 && (
            <Section title="Contact" colors={colors}>
              {filledContactRows.map(({ f, value }) => (
                <Row
                  key={f.key}
                  label={f.label}
                  value={value}
                  colors={colors}
                  iconName={iconForUserField(f.userField!)}
                />
              ))}
            </Section>
          )}
        </ScrollView>

        <EditProfileModal visible={editOpen} onClose={() => setEditOpen(false)} />
      </View>
    </Modal>
  );
}

function iconForUserField(f: NonNullable<IntakeField["userField"]>): keyof typeof Feather.glyphMap {
  switch (f) {
    case "website":
      return "globe";
    case "officePhone":
      return "phone";
    case "cellPhone":
      return "smartphone";
    case "instagram":
      return "instagram";
    case "bio":
      return "edit-3";
  }
}

function Section({
  title,
  colors,
  children,
}: {
  title: string;
  colors: ColorScheme;
  children: React.ReactNode;
}) {
  return (
    <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>{title.toUpperCase()}</Text>
      <View style={{ gap: 4, marginTop: 4 }}>{children}</View>
    </View>
  );
}

function Row({
  label,
  value,
  colors,
  iconName,
}: {
  label: string;
  value: string;
  colors: ColorScheme;
  iconName?: keyof typeof Feather.glyphMap;
}) {
  return (
    <View style={styles.row}>
      <Text style={[styles.rowLabel, { color: colors.mutedForeground }]}>{label}</Text>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 2 }}>
        {iconName ? <Feather name={iconName} size={14} color={colors.mutedForeground} /> : null}
        <Text style={[styles.rowValue, { color: colors.foreground }]} numberOfLines={3}>
          {value}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTitle: { fontSize: 16, fontFamily: "Inter_700Bold" },
  iconBtn: { padding: 4, minWidth: 50, alignItems: "center" },
  editText: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  scroll: { padding: 16, gap: 16 },
  identityRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingBottom: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  avatar: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  avatarImg: { width: "100%", height: "100%" },
  company: { fontSize: 22, fontFamily: "Inter_700Bold", lineHeight: 26 },
  nameLarge: { fontSize: 20, fontFamily: "Inter_700Bold" },
  nameSecondary: { fontSize: 14, fontFamily: "Inter_500Medium", marginTop: 2 },
  handle: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  privacyHintRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: 4,
  },
  privacyHintText: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    flexShrink: 1,
  },
  section: { borderRadius: 16, borderWidth: 1, padding: 12, gap: 4 },
  sectionTitle: {
    fontSize: 11,
    fontFamily: "Inter_700Bold",
    letterSpacing: 0.8,
    paddingHorizontal: 4,
    paddingTop: 2,
  },
  row: {
    paddingVertical: 10,
    paddingHorizontal: 8,
  },
  rowLabel: { fontSize: 12, fontFamily: "Inter_500Medium" },
  rowValue: { fontSize: 15, fontFamily: "Inter_500Medium", flexShrink: 1 },
});
