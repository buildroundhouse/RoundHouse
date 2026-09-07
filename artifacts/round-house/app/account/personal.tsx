import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { confirm } from "@/lib/confirm";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetMyPersonalProfile,
  useUpdateMyPersonalProfile,
  useSwitchActiveMode,
  type UserModeProfile,
} from "@workspace/api-client-react";
import { useColors } from "@/hooks/useColors";
import { useProfile } from "@/lib/profile";
import { resolveStorageUrl } from "@/lib/uploads";
import { MODE_LABELS } from "@/lib/intake-schemas";
import { EditProfileModal } from "@/components/EditProfileModal";

/**
 * Personal Profile screen.
 *
 * The "private side" of identity: things that belong to the person, not to
 * any one outward-facing account. These fields live on the users-table row
 * directly and are read/written via /users/me/personal — which is the
 * non-hydrated endpoint, so per-account fields (per-account phone, per-account
 * avatar, etc.) cannot bleed into or stomp the personal copy.
 *
 * Legal name is intentionally NOT surfaced here. The screen shows the
 * personal fields that aren't legal name (username, avatar, email, phone,
 * notification toggles) plus an "Intake information" section that lets the
 * user reopen the same intake editor used on the Profile tab for any of
 * their modes/accounts.
 *
 * Outward branding (avatar, bio, company name, business phone, …) is edited
 * from /account/edit/[id] — see OutwardAccountForm.
 */
export default function PersonalProfileScreen() {
  const colors = useColors();
  const router = useRouter();
  const queryClient = useQueryClient();
  const {
    profile,
    modes,
    activeMode,
    outwardAccounts,
    refetchProfile,
    refetchModes,
  } = useProfile();
  const switchModeMutation = useSwitchActiveMode();

  // Read raw personal profile (separate from /users/me to avoid the
  // active-mode overlay).
  const { data: personal, isLoading } = useGetMyPersonalProfile();
  const updateMutation = useUpdateMyPersonalProfile();

  const [editing, setEditing] = useState(false);
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");

  // Intake editor: we reuse the same EditProfileModal the Profile tab uses,
  // but it implicitly scopes to the active mode. So before opening it for a
  // non-active mode, we switch the active mode first and wait for the
  // profile/modes refresh so the modal reads the right intakeData.
  const [intakeEditorOpen, setIntakeEditorOpen] = useState(false);
  const [switchingModeId, setSwitchingModeId] = useState<number | null>(null);

  useEffect(() => {
    if (!personal) return;
    setEmail(personal.email ?? "");
    setPhone(personal.phone ?? "");
  }, [personal?.id, personal?.email, personal?.phone]);

  const personalAvatar = useMemo(() => {
    return personal?.avatarUrl ?? profile?.avatarUrl ?? null;
  }, [personal?.avatarUrl, profile?.avatarUrl]);

  const onSave = async () => {
    try {
      await updateMutation.mutateAsync({
        data: {
          email: email.trim() || undefined,
          phone: phone.trim() ? phone.trim() : null,
        },
      });
      setEditing(false);
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Couldn't save changes.";
      Alert.alert("Save failed", message);
    }
  };

  // Surface every mode that has intake data (whether the user has finished
  // intake yet or not). Even an in-progress mode has answers that the user
  // may want to revisit and tweak from Settings.
  const intakeModes = useMemo(() => {
    return modes.filter((m) => {
      const data = (m.intakeData ?? {}) as Record<string, unknown>;
      return m.intakeCompletedAt != null || Object.keys(data).length > 0;
    });
  }, [modes]);

  const onEditIntake = async (mode: UserModeProfile) => {
    try {
      if (mode.id !== activeMode?.id) {
        setSwitchingModeId(mode.id);
        await switchModeMutation.mutateAsync({ data: { modeId: mode.id } });
        await Promise.all([refetchProfile(), refetchModes()]);
        await queryClient.invalidateQueries();
      }
      setIntakeEditorOpen(true);
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Couldn't open the editor.";
      Alert.alert("Couldn't open editor", message);
    } finally {
      setSwitchingModeId(null);
    }
  };

  // The header-right "Admin Hub" / "Done" link that used to live up
  // here was removed when the white route header was hidden in
  // app/account/_layout.tsx. The in-page primary "Done — back to
  // home" button below now owns the only exit affordance and has
  // its own dirty-edit confirm + router logic.

  const onIntakeEditorClose = async () => {
    setIntakeEditorOpen(false);
    // Make sure the Profile tab and anywhere else that reads modes/profile
    // sees the freshly-saved intake data immediately.
    await Promise.all([refetchProfile(), refetchModes()]);
    await queryClient.invalidateQueries();
  };

  const intakeModeTitle = (mode: UserModeProfile): string => {
    const data = (mode.intakeData ?? {}) as Record<string, unknown>;
    const candidates: unknown[] = [];
    switch (mode.kind) {
      case "trade_pro":
        candidates.push(data.companyName);
        break;
      case "home":
        candidates.push(data.placeName, data.neighborhood);
        break;
      case "facilities":
        candidates.push(data.placeName, data.operationKind);
        break;
      case "trade_pro_teammate":
      case "facilities_teammate":
      case "home_teammate":
        candidates.push(data.displayName, data.belongsTo);
        break;
      default:
        break;
    }
    for (const c of candidates) {
      if (typeof c === "string" && c.trim().length > 0) return c.trim();
    }
    return MODE_LABELS[mode.kind];
  };

  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 48 }}
    >
      {/*
        Header bar is hidden by app/account/_layout.tsx (headerShown:
        false on the personal route). The dead <Stack.Screen
        headerRight={...}> override that used to live here was
        removed because (a) it never won against the layout's options
        when nested inside ScrollView, and (b) the in-page primary
        "Done — back to home" button below now owns the only exit
        affordance.
      */}
      <Text
        style={[
          styles.banner,
          {
            backgroundColor: colors.muted,
            color: colors.mutedForeground,
          },
        ]}
      >
        This is your private profile. It belongs to you — not to any one
        outward account — so editing it never changes how your public
        accounts look.
      </Text>

      <View style={[styles.headerRow]}>
        <View style={[styles.avatar, { backgroundColor: colors.muted }]}>
          {personalAvatar ? (
            <Image
              source={{ uri: resolveStorageUrl(personalAvatar)! }}
              style={styles.avatarImg}
            />
          ) : (
            <Feather name="user" size={28} color={colors.mutedForeground} />
          )}
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.username, { color: colors.foreground }]}>
            @{profile?.username || "username"}
          </Text>
          <Text style={[styles.usernameHelp, { color: colors.mutedForeground }]}>
            Your handle. Shared across every account you run.
          </Text>
        </View>
      </View>

      {isLoading && !personal ? (
        <ActivityIndicator color={colors.primary} />
      ) : editing ? (
        <View style={{ gap: 10 }}>
          <LabeledInput
            label="Email"
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            colors={colors}
          />
          <LabeledInput
            label="Phone"
            value={phone}
            onChangeText={setPhone}
            keyboardType="phone-pad"
            colors={colors}
          />
          <View style={{ flexDirection: "row", gap: 10 }}>
            <Pressable
              onPress={() => {
                setEditing(false);
                if (personal) {
                  setEmail(personal.email ?? "");
                  setPhone(personal.phone ?? "");
                }
              }}
              style={({ pressed }) => [
                styles.btn,
                {
                  borderColor: colors.border,
                  backgroundColor: colors.card,
                  opacity: pressed ? 0.85 : 1,
                  flex: 1,
                },
              ]}
            >
              <Text style={[styles.btnTxt, { color: colors.foreground }]}>
                Cancel
              </Text>
            </Pressable>
            <Pressable
              onPress={onSave}
              disabled={updateMutation.isPending}
              style={({ pressed }) => [
                styles.btn,
                {
                  borderColor: colors.primary,
                  backgroundColor: colors.primary,
                  opacity:
                    pressed || updateMutation.isPending ? 0.85 : 1,
                  flex: 1,
                },
              ]}
            >
              {updateMutation.isPending ? (
                <ActivityIndicator color={colors.primaryForeground} />
              ) : (
                <Text
                  style={[
                    styles.btnTxt,
                    { color: colors.primaryForeground },
                  ]}
                >
                  Save
                </Text>
              )}
            </Pressable>
          </View>
        </View>
      ) : (
        <View style={{ gap: 10 }}>
          <Field label="Email" value={personal?.email} colors={colors} />
          <Field label="Phone" value={personal?.phone ?? null} colors={colors} />
          <Pressable
            onPress={() => setEditing(true)}
            style={({ pressed }) => [
              styles.editBtn,
              {
                borderColor: colors.border,
                opacity: pressed ? 0.85 : 1,
              },
            ]}
          >
            <Feather name="edit-2" size={14} color={colors.foreground} />
            <Text style={[styles.editTxt, { color: colors.foreground }]}>
              Edit personal info
            </Text>
          </Pressable>
        </View>
      )}

      <Text
        style={[styles.h2, { color: colors.foreground, marginTop: 16 }]}
      >
        Notification preferences
      </Text>
      <Toggle
        label="Notify me when a job starts"
        value={!!personal?.notifyJobStarted}
        disabled={updateMutation.isPending}
        onChange={(v) =>
          updateMutation.mutate({ data: { notifyJobStarted: v } })
        }
        colors={colors}
      />
      <Toggle
        label="Notify me when a job is completed"
        value={!!personal?.notifyJobCompleted}
        disabled={updateMutation.isPending}
        onChange={(v) =>
          updateMutation.mutate({ data: { notifyJobCompleted: v } })
        }
        colors={colors}
      />

      <Text
        style={[styles.h2, { color: colors.foreground, marginTop: 16 }]}
      >
        Intake information
      </Text>
      <Text style={[styles.help, { color: colors.mutedForeground }]}>
        Revisit the answers you gave when you set up each account — business
        details, property info, focus areas, and so on. Edits save back to
        the same place your Profile tab shows them.
      </Text>
      {intakeModes.length === 0 ? (
        <View
          style={[
            styles.field,
            { borderColor: colors.border, backgroundColor: colors.card },
          ]}
        >
          <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>
            No intake answers yet. Add an account to fill some in.
          </Text>
        </View>
      ) : intakeModes.length === 1 ? (
        <Pressable
          onPress={() => onEditIntake(intakeModes[0])}
          disabled={switchingModeId != null}
          style={({ pressed }) => [
            styles.editBtn,
            {
              borderColor: colors.border,
              opacity: pressed ? 0.85 : 1,
            },
          ]}
        >
          {switchingModeId === intakeModes[0].id ? (
            <ActivityIndicator size="small" color={colors.foreground} />
          ) : (
            <Feather name="edit-2" size={14} color={colors.foreground} />
          )}
          <Text style={[styles.editTxt, { color: colors.foreground }]}>
            Edit intake information
          </Text>
        </Pressable>
      ) : (
        <View style={{ gap: 10 }}>
          {intakeModes.map((mode) => {
            const busy = switchingModeId === mode.id;
            return (
              <View
                key={mode.id}
                style={[
                  styles.intakeRow,
                  {
                    borderColor: colors.border,
                    backgroundColor: colors.card,
                  },
                ]}
              >
                <View style={{ flex: 1 }}>
                  <Text
                    style={[styles.rowTitle, { color: colors.foreground }]}
                    numberOfLines={1}
                  >
                    {intakeModeTitle(mode)}
                  </Text>
                  <Text
                    style={[
                      styles.rowSub,
                      { color: colors.mutedForeground },
                    ]}
                    numberOfLines={1}
                  >
                    {MODE_LABELS[mode.kind]}
                    {mode.intakeCompletedAt ? "" : " · setup in progress"}
                  </Text>
                </View>
                <Pressable
                  onPress={() => onEditIntake(mode)}
                  disabled={switchingModeId != null}
                  accessibilityLabel={`Edit intake information for ${intakeModeTitle(mode)}`}
                  style={({ pressed }) => [
                    styles.intakeBtn,
                    {
                      borderColor: colors.border,
                      opacity: pressed ? 0.85 : 1,
                    },
                  ]}
                >
                  {busy ? (
                    <ActivityIndicator
                      size="small"
                      color={colors.foreground}
                    />
                  ) : (
                    <Feather
                      name="edit-2"
                      size={14}
                      color={colors.foreground}
                    />
                  )}
                  <Text
                    style={[styles.editTxt, { color: colors.foreground }]}
                  >
                    Edit
                  </Text>
                </Pressable>
              </View>
            );
          })}
        </View>
      )}

      <Text
        style={[styles.h2, { color: colors.foreground, marginTop: 16 }]}
      >
        Public skins connected to this profile
      </Text>
      <Text style={[styles.help, { color: colors.mutedForeground }]}>
        You currently have {outwardAccounts.length}{" "}
        {outwardAccounts.length === 1
          ? "outward account"
          : "outward accounts"}.
        Editing them never changes your personal info above.
      </Text>
      <LinkRow
        icon="users"
        label="Manage outward accounts"
        onPress={() => router.push("/account" as never)}
        colors={colors}
      />

      {/*
        The user reported this screen was "a trap" — there's a small
        "Admin Hub"/"Done" link in the header but it's easy to miss
        once you've scrolled past the fold. A full-width primary
        button at the end of the form gives an unmissable exit
        straight to the home screen, with the same dirty-edit
        confirmation as the header link via onExitToHome.
      */}
      <Pressable
        onPress={async () => {
          if (editing) {
            const dirty =
              email.trim() !== (personal?.email ?? "") ||
              phone.trim() !== (personal?.phone ?? "");
            if (dirty) {
              const ok = await confirm({
                title: "Discard unsaved changes?",
                message: "You have unsaved edits to your personal info.",
                confirmLabel: "Discard",
                cancelLabel: "Keep editing",
                destructive: true,
              });
              if (!ok) return;
            }
          }
          router.replace("/(tabs)" as never);
        }}
        accessibilityRole="link"
        accessibilityLabel="Done — go to home screen"
        style={({ pressed }) => [
          styles.btn,
          {
            backgroundColor: colors.primary,
            borderColor: colors.primary,
            marginTop: 16,
            opacity: pressed ? 0.85 : 1,
          },
        ]}
      >
        <Text style={[styles.btnTxt, { color: colors.primaryForeground }]}>
          Done — back to home
        </Text>
      </Pressable>

      <EditProfileModal
        visible={intakeEditorOpen}
        onClose={onIntakeEditorClose}
      />
    </ScrollView>
  );
}

function Field({
  label,
  value,
  colors,
}: {
  label: string;
  value: string | null | undefined;
  colors: ReturnType<typeof useColors>;
}) {
  return (
    <View
      style={[
        styles.field,
        { borderColor: colors.border, backgroundColor: colors.card },
      ]}
    >
      <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>
        {label}
      </Text>
      <Text style={[styles.fieldValue, { color: colors.foreground }]}>
        {value && value.length > 0 ? value : "—"}
      </Text>
    </View>
  );
}

function LabeledInput({
  label,
  colors,
  ...props
}: {
  label: string;
  colors: ReturnType<typeof useColors>;
} & React.ComponentProps<typeof TextInput>) {
  return (
    <View
      style={[
        styles.field,
        { borderColor: colors.border, backgroundColor: colors.card },
      ]}
    >
      <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>
        {label}
      </Text>
      <TextInput
        {...props}
        placeholderTextColor={colors.mutedForeground}
        style={[styles.input, { color: colors.foreground }]}
      />
    </View>
  );
}

function Toggle({
  label,
  value,
  disabled,
  onChange,
  colors,
}: {
  label: string;
  value: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
  colors: ReturnType<typeof useColors>;
}) {
  return (
    <View
      style={[
        styles.linkRow,
        { borderColor: colors.border, backgroundColor: colors.card },
      ]}
    >
      <Text
        style={[
          styles.linkTxt,
          { color: colors.foreground, flex: 1 },
        ]}
      >
        {label}
      </Text>
      <Switch
        value={value}
        onValueChange={onChange}
        disabled={disabled}
      />
    </View>
  );
}

function LinkRow({
  icon,
  label,
  helper,
  onPress,
  colors,
}: {
  icon: React.ComponentProps<typeof Feather>["name"];
  label: string;
  helper?: string;
  onPress: () => void;
  colors: ReturnType<typeof useColors>;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.linkRow,
        { borderColor: colors.border, opacity: pressed ? 0.85 : 1 },
      ]}
    >
      <Feather name={icon} size={16} color={colors.foreground} />
      <View style={{ flex: 1 }}>
        <Text style={[styles.linkTxt, { color: colors.foreground }]}>
          {label}
        </Text>
        {helper ? (
          <Text style={[styles.linkHelper, { color: colors.mutedForeground }]}>
            {helper}
          </Text>
        ) : null}
      </View>
      <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  banner: {
    fontSize: 12,
    fontFamily: "Inter_500Medium",
    padding: 12,
    borderRadius: 10,
    overflow: "hidden",
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingVertical: 8,
  },
  avatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarImg: { width: "100%", height: "100%" },
  username: { fontSize: 18, fontFamily: "Inter_700Bold" },
  usernameHelp: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    marginTop: 2,
  },
  field: {
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    gap: 4,
  },
  fieldLabel: {
    fontSize: 11,
    fontFamily: "Inter_700Bold",
    letterSpacing: 0.8,
  },
  fieldValue: { fontSize: 15, fontFamily: "Inter_500Medium" },
  input: {
    fontSize: 15,
    fontFamily: "Inter_500Medium",
    paddingVertical: 4,
  },
  editBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
    marginTop: 4,
  },
  editTxt: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  btn: {
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  btnTxt: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  h2: { fontSize: 16, fontFamily: "Inter_700Bold" },
  help: { fontSize: 13, fontFamily: "Inter_400Regular" },
  linkRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 10,
    borderWidth: 1,
  },
  linkTxt: { flex: 1, fontSize: 14, fontFamily: "Inter_600SemiBold" },
  linkHelper: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    marginTop: 2,
  },
  intakeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 10,
    borderWidth: 1,
  },
  intakeBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
  },
  rowTitle: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  rowSub: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
});
