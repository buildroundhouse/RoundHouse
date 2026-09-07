import React, { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { useColors } from "@/hooks/useColors";
import { resolveStorageUrl, uploadAsset } from "@/lib/uploads";
import { ServicesPickerModal } from "@/components/ServicesPickerModal";
import type { ServiceEntry } from "@workspace/api-client-react";
export type OutwardAccountKind = "trade_pro" | "home" | "facilities";

// Continuity rule: a person's AVATAR and FIRST NAME are shared across every
// outward-facing account they run — those live on the personal `users` row
// and are edited from the Personal Profile screen, not here. Each outward
// account only owns its public BANNER, business/display name, company name
// and bio. This keeps a consistent face on every interaction so contacts
// always recognize who they're talking to, regardless of which skin is active.
export type OutwardAccountFormValues = {
  kind: OutwardAccountKind;
  title: string;
  displayName: string;
  bannerUrl: string | null;
  companyName: string;
  bio: string;
  // #640 — Per-skin "show only my last initial" privacy toggle. When
  // ON, the owner's name is rendered as "First L." everywhere this
  // skin appears (People search, public profile, chat headers).
  lastInitialOnly: boolean;
};

export const KIND_OPTIONS: Array<{
  kind: OutwardAccountKind;
  label: string;
  description: string;
  icon: keyof typeof Feather.glyphMap;
}> = [
  {
    kind: "home",
    label: "Home",
    description: "I take care of one or more homes.",
    icon: "home",
  },
  {
    kind: "trade_pro",
    label: "Trade Pro",
    description: "I provide trade services to clients.",
    icon: "tool",
  },
  {
    kind: "facilities",
    label: "Facility Management",
    description: "I manage facilities or commercial properties.",
    icon: "briefcase",
  },
];

type Props = {
  initial: OutwardAccountFormValues;
  /** When true, the kind selector is hidden (kind is fixed on edit). */
  lockKind?: boolean;
  submitLabel: string;
  onSubmit: (values: OutwardAccountFormValues) => Promise<void>;
  onCancel?: () => void;
  /**
   * When true, shows a "Make this my active account on save" toggle.
   */
  showActivateToggle?: boolean;
  activate?: boolean;
  onActivateChange?: (next: boolean) => void;
  /**
   * Optional content rendered below the Save / Cancel row, inside the
   * scroll view. Used by the edit screen to attach a destructive
   * "Danger zone" panel without forking the form layout.
   */
  footer?: React.ReactNode;
  /**
   * When provided, renders a SERVICES section with a picker. At least
   * one service is required before the form can be submitted. Used on
   * skin signup so every new account declares what it offers.
   */
  services?: ServiceEntry[];
  onServicesChange?: (next: ServiceEntry[]) => void;
  /**
   * Per-kind availability info from the parent. When a kind has hit its
   * cap (e.g. 5 of 5 Trade Pro accounts), the row is disabled inline
   * with a "Limit reached" subtitle so the user can't even pick it. The
   * server enforces the same cap defensively.
   */
  kindAvailability?: Partial<
    Record<OutwardAccountKind, { count: number; limit?: number }>
  >;
};

export function OutwardAccountForm({
  initial,
  lockKind = false,
  submitLabel,
  onSubmit,
  onCancel,
  showActivateToggle,
  activate,
  onActivateChange,
  footer,
  services,
  onServicesChange,
  kindAvailability,
}: Props) {
  const colors = useColors();
  const [values, setValues] = useState<OutwardAccountFormValues>(initial);
  const [submitting, setSubmitting] = useState(false);
  const [uploadingSlot, setUploadingSlot] = useState<"banner" | null>(null);
  const [error, setError] = useState("");
  const [servicesPickerOpen, setServicesPickerOpen] = useState(false);
  const servicesEnabled = services !== undefined && !!onServicesChange;

  const set = <K extends keyof OutwardAccountFormValues>(
    key: K,
    next: OutwardAccountFormValues[K],
  ) => setValues((v) => ({ ...v, [key]: next }));

  const pickBanner = async () => {
    try {
      // On web (incl. mobile Safari PWA) the file picker itself is the
      // implicit consent — calling requestMediaLibraryPermissionsAsync
      // there returns "undetermined" and would block the upload, so we
      // only ask for permission on native platforms.
      if (Platform.OS !== "web") {
        const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (perm.status !== "granted") {
          Alert.alert("Permission needed", "Allow photo access to upload images.");
          return;
        }
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [16, 9],
        quality: 0.9,
      });
      if (result.canceled || !result.assets?.[0]) return;
      const asset = result.assets[0];
      setUploadingSlot("banner");
      const uploaded = await uploadAsset({
        uri: asset.uri,
        name: asset.fileName ?? null,
        contentType: asset.mimeType ?? null,
        size: asset.fileSize ?? null,
      });
      set("bannerUrl", uploaded.path);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't upload that image.");
    } finally {
      setUploadingSlot(null);
    }
  };

  const submit = async () => {
    const title = values.title.trim();
    const displayName = values.displayName.trim();
    if (!title) {
      setError("Give this account a short title (e.g. 'My side gig').");
      return;
    }
    if (!displayName) {
      setError("Choose a display name people will see on this skin.");
      return;
    }
    if (servicesEnabled && (services?.length ?? 0) === 0) {
      setError("Pick at least one service this account offers.");
      return;
    }
    setError("");
    setSubmitting(true);
    try {
      await onSubmit({ ...values, title, displayName });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save this account.");
    } finally {
      setSubmitting(false);
    }
  };

  const Label = ({ children }: { children: React.ReactNode }) => (
    <Text style={[styles.label, { color: colors.mutedForeground }]}>
      {children}
    </Text>
  );

  const Input = (props: React.ComponentProps<typeof TextInput>) => (
    <TextInput
      {...props}
      placeholderTextColor={colors.mutedForeground}
      style={[
        styles.input,
        {
          backgroundColor: colors.card,
          borderColor: colors.border,
          color: colors.foreground,
        },
        props.multiline ? { minHeight: 88, textAlignVertical: "top" } : null,
        props.style,
      ]}
    />
  );

  const bannerUri = resolveStorageUrl(values.bannerUrl);

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        style={{ backgroundColor: colors.background }}
        contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 60 }}
        keyboardShouldPersistTaps="handled"
      >
        {!lockKind ? (
          <View style={{ gap: 8 }}>
            <Label>WHAT KIND OF ACCOUNT?</Label>
            {KIND_OPTIONS.map((opt) => {
              const selected = values.kind === opt.kind;
              const avail = kindAvailability?.[opt.kind];
              const hasLimit = avail?.limit !== undefined;
              const capped = hasLimit && avail!.count >= avail!.limit!;
              // When a cap exists, always show a "X of N used" hint so the
              // user can see how much headroom they have before hitting it
              // — not just once they're already locked out.
              const subtitle = capped
                ? `Limit reached (${avail!.count}/${avail!.limit})`
                : hasLimit
                  ? `${opt.description} · ${avail!.count} of ${avail!.limit} used`
                  : opt.description;
              return (
                <Pressable
                  key={opt.kind}
                  onPress={() => (capped ? undefined : set("kind", opt.kind))}
                  disabled={capped}
                  style={[
                    styles.kindRow,
                    {
                      borderColor: selected ? colors.primary : colors.border,
                      backgroundColor: selected
                        ? colors.primary + "10"
                        : colors.card,
                      opacity: capped ? 0.5 : 1,
                    },
                  ]}
                >
                  <Feather
                    name={opt.icon}
                    size={20}
                    color={selected ? colors.primary : colors.foreground}
                  />
                  <View style={{ flex: 1 }}>
                    <Text
                      style={[styles.kindTitle, { color: colors.foreground }]}
                    >
                      {opt.label}
                    </Text>
                    <Text
                      style={[
                        styles.kindDesc,
                        { color: colors.mutedForeground },
                      ]}
                    >
                      {subtitle}
                    </Text>
                  </View>
                  {selected ? (
                    <Feather
                      name="check-circle"
                      size={20}
                      color={colors.primary}
                    />
                  ) : null}
                </Pressable>
              );
            })}
          </View>
        ) : null}

        <View style={{ gap: 8 }}>
          <Label>BANNER</Label>
          <Pressable
            onPress={pickBanner}
            style={[
              styles.bannerPick,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            {bannerUri ? (
              <Image source={{ uri: bannerUri }} style={styles.bannerImg} />
            ) : (
              <View style={styles.bannerEmpty}>
                <Feather name="image" size={20} color={colors.mutedForeground} />
                <Text
                  style={{
                    color: colors.mutedForeground,
                    fontFamily: "Inter_500Medium",
                  }}
                >
                  Tap to add a banner
                </Text>
              </View>
            )}
            {uploadingSlot === "banner" ? (
              <View style={styles.uploadingOverlay}>
                <ActivityIndicator color="#fff" />
              </View>
            ) : null}
          </Pressable>
          <Text
            style={{
              color: colors.mutedForeground,
              fontSize: 12,
              fontFamily: "Inter_400Regular",
            }}
          >
            Your avatar and first name come from your personal profile and stay
            the same across every account, so people always recognize you.
          </Text>
        </View>

        <View style={{ gap: 6 }}>
          <Label>TITLE (your reference)</Label>
          <Input
            value={values.title}
            onChangeText={(t) => set("title", t)}
            placeholder="e.g. My weekend painting business"
            maxLength={80}
          />
        </View>

        <View style={{ gap: 6 }}>
          <Label>DISPLAY NAME (public)</Label>
          <Input
            value={values.displayName}
            onChangeText={(t) => set("displayName", t)}
            placeholder="e.g. Cardinal Painting"
            maxLength={80}
          />
        </View>

        <View style={{ gap: 6 }}>
          <Label>COMPANY NAME (optional)</Label>
          <Input
            value={values.companyName}
            onChangeText={(t) => set("companyName", t)}
            placeholder="Legal or trading company name"
            maxLength={120}
          />
        </View>

        <View style={{ gap: 6 }}>
          <Label>BIO</Label>
          <Input
            value={values.bio}
            onChangeText={(t) => set("bio", t)}
            placeholder="A short description shown on your public profile."
            multiline
            maxLength={500}
          />
        </View>

        {/* #640 — Per-skin privacy toggle. Owner's name is shortened to
            "First L." on this skin's People search row, public profile
            header, and chat threads when ON. Each skin can choose
            independently so a Trade Pro can stay full-name while a
            Homeowner skin stays last-initial-only. */}
        <Pressable
          onPress={() => set("lastInitialOnly", !values.lastInitialOnly)}
          accessibilityRole="button"
          accessibilityLabel="Show only my last initial on this account"
          accessibilityState={{ checked: values.lastInitialOnly }}
          style={[
            styles.toggleRow,
            { borderColor: colors.border, backgroundColor: colors.card },
          ]}
        >
          <View
            style={[
              styles.checkbox,
              {
                borderColor: values.lastInitialOnly
                  ? colors.primary
                  : colors.border,
                backgroundColor: values.lastInitialOnly
                  ? colors.primary
                  : "transparent",
              },
            ]}
          >
            {values.lastInitialOnly ? (
              <Feather name="check" size={14} color="#fff" />
            ) : null}
          </View>
          <View style={{ flex: 1 }}>
            <Text
              style={{
                color: colors.foreground,
                fontFamily: "Inter_600SemiBold",
              }}
            >
              Show only my last initial on this account
            </Text>
            <Text
              style={{
                color: colors.mutedForeground,
                fontSize: 12,
                fontFamily: "Inter_400Regular",
                marginTop: 2,
              }}
            >
              People will see your name as "First L." in search, on this
              profile, and in chats from this account.
            </Text>
          </View>
        </Pressable>

        {servicesEnabled ? (
          <View style={{ gap: 6 }}>
            <Label>SERVICES (pick at least one)</Label>
            <Pressable
              onPress={() => setServicesPickerOpen(true)}
              style={[
                styles.servicesRow,
                { backgroundColor: colors.card, borderColor: colors.border },
              ]}
              accessibilityRole="button"
              accessibilityLabel="Choose services this account offers"
            >
              <View style={{ flex: 1 }}>
                {(services?.length ?? 0) === 0 ? (
                  <Text
                    style={{
                      color: colors.mutedForeground,
                      fontFamily: "Inter_500Medium",
                    }}
                  >
                    Tap to choose services
                  </Text>
                ) : (
                  <View style={styles.chipWrap}>
                    {services!.map((s) => (
                      <View
                        key={s.name}
                        style={[
                          styles.chip,
                          {
                            backgroundColor: colors.primary + "15",
                            borderColor: colors.primary + "40",
                          },
                        ]}
                      >
                        <Text
                          style={{
                            color: colors.foreground,
                            fontFamily: "Inter_500Medium",
                            fontSize: 12,
                          }}
                        >
                          {s.name}
                        </Text>
                      </View>
                    ))}
                  </View>
                )}
              </View>
              <Feather
                name="chevron-right"
                size={18}
                color={colors.mutedForeground}
              />
            </Pressable>
            <Text
              style={{
                color: colors.mutedForeground,
                fontSize: 12,
                fontFamily: "Inter_400Regular",
              }}
            >
              Every account must offer at least one service so people know
              what this skin does.
            </Text>
          </View>
        ) : null}

        {showActivateToggle ? (
          <Pressable
            onPress={() => onActivateChange?.(!activate)}
            accessibilityRole="button"
            accessibilityLabel="Switch to this account when I save"
            accessibilityState={{ checked: !!activate }}
            style={[
              styles.toggleRow,
              { borderColor: colors.border, backgroundColor: colors.card },
            ]}
          >
            <View
              style={[
                styles.checkbox,
                {
                  borderColor: activate ? colors.primary : colors.border,
                  backgroundColor: activate ? colors.primary : "transparent",
                },
              ]}
            >
              {activate ? (
                <Feather name="check" size={14} color="#fff" />
              ) : null}
            </View>
            <Text style={{ color: colors.foreground, flex: 1 }}>
              Switch to this account when I save
            </Text>
          </Pressable>
        ) : null}

        {error ? (
          <Text style={{ color: colors.destructive, fontSize: 13 }}>
            {error}
          </Text>
        ) : null}

        <View style={{ flexDirection: "row", gap: 10, marginTop: 4 }}>
          {onCancel ? (
            <Pressable
              onPress={onCancel}
              style={({ pressed }) => [
                styles.btnGhost,
                { borderColor: colors.border, opacity: pressed ? 0.7 : 1 },
              ]}
            >
              <Text style={{ color: colors.foreground, fontFamily: "Inter_600SemiBold" }}>
                Cancel
              </Text>
            </Pressable>
          ) : null}
          <Pressable
            onPress={submit}
            disabled={submitting}
            style={({ pressed }) => [
              styles.btnPrimary,
              { backgroundColor: colors.primary, opacity: pressed ? 0.85 : 1 },
            ]}
          >
            {submitting ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={{ color: "#fff", fontFamily: "Inter_600SemiBold" }}>
                {submitLabel}
              </Text>
            )}
          </Pressable>
        </View>

        {footer}
      </ScrollView>

      {servicesEnabled ? (
        <ServicesPickerModal
          visible={servicesPickerOpen}
          initial={services ?? []}
          onClose={() => setServicesPickerOpen(false)}
          onSave={async (next) => {
            onServicesChange?.(next);
            setServicesPickerOpen(false);
          }}
        />
      ) : null}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  label: {
    fontSize: 11,
    fontFamily: "Inter_700Bold",
    letterSpacing: 0.8,
  },
  input: {
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
    fontSize: 15,
    fontFamily: "Inter_500Medium",
  },
  kindRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
  },
  kindTitle: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  kindDesc: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  bannerPick: {
    height: 130,
    borderRadius: 12,
    borderWidth: 1,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  bannerImg: { width: "100%", height: "100%" },
  bannerEmpty: { alignItems: "center", gap: 6 },
  servicesRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
    minHeight: 48,
  },
  chipWrap: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
  },
  avatarPick: {
    width: 64,
    height: 64,
    borderRadius: 32,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarImg: { width: "100%", height: "100%" },
  uploadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.45)",
    alignItems: "center",
    justifyContent: "center",
  },
  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  btnPrimary: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  btnGhost: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
});
