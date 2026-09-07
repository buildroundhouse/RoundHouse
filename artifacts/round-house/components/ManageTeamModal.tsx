import React, { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQueryClient } from "@tanstack/react-query";
import { useColors } from "@/hooks/useColors";
import {
  useListMyTeam,
  useInviteTeamMember,
  useRemoveTeamMember,
  useUpdateMyTeamMemberChip,
  getListMyTeamQueryKey,
  type TeamRole,
} from "@workspace/api-client-react";
import { TeamSection } from "./TeamSection";
import { useProfile } from "@/lib/profile";
import {
  TRADE_PRO_TEAMMATE_OPTIONS,
  FACILITY_TEAMMATE_OPTIONS,
  teammateChipLabel,
} from "@/lib/connectionTags";
import { confirm } from "@/lib/confirm";

type Props = {
  visible: boolean;
  onClose: () => void;
};

const ROLE_OPTIONS: { value: TeamRole; label: string; subtitle: string }[] = [
  { value: "employee", label: "Employee", subtitle: "Works for you on jobs." },
  { value: "manager", label: "Manager", subtitle: "Coordinates jobs and crews." },
  { value: "partner", label: "Partner", subtitle: "Co-owner or strategic partner." },
];

function chipOptionsFor(companyKind: "trade_pro" | "facilities" | null) {
  if (companyKind === "trade_pro") return TRADE_PRO_TEAMMATE_OPTIONS;
  if (companyKind === "facilities") return FACILITY_TEAMMATE_OPTIONS;
  return [];
}

export function ManageTeamModal({ visible, onClose }: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const { data, isFetching } = useListMyTeam({
    query: { enabled: visible, queryKey: getListMyTeamQueryKey() },
  });
  const invite = useInviteTeamMember();
  const remove = useRemoveTeamMember();
  const updateChip = useUpdateMyTeamMemberChip();

  const [identifier, setIdentifier] = useState("");
  const [role, setRole] = useState<TeamRole>("employee");
  // #548 — admin-seeded chip on invite.
  const [inviteChip, setInviteChip] = useState<string>("");
  const [inviteChipOther, setInviteChipOther] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);

  // #548 — per-row "Change chip" sheet state.
  const [chipEditFor, setChipEditFor] = useState<{
    memberClerkId: string;
    name: string;
    chip: string;
    chipOther: string;
  } | null>(null);

  const members = data?.members ?? [];
  // #502 — companyKind selects the curated teammate-chip vocabulary.
  const { activeOutwardAccount } = useProfile();
  const outwardKind = activeOutwardAccount?.kind ?? null;
  const companyKind: "trade_pro" | "facilities" | null =
    outwardKind === "trade_pro"
      ? "trade_pro"
      : outwardKind === "facilities"
        ? "facilities"
        : null;
  const chipOptions = chipOptionsFor(companyKind);

  async function handleInvite() {
    const value = identifier.trim();
    if (!value) {
      Alert.alert("Enter a username or email", "Search by @username or email.");
      return;
    }
    setSubmitting(true);
    try {
      const body: {
        role: TeamRole;
        username?: string;
        email?: string;
        chip?: string | null;
        chipOther?: string | null;
        companyKind?: string | null;
      } = { role };
      if (value.includes("@") && value.includes(".")) {
        body.email = value;
      } else {
        body.username = value.replace(/^@/, "");
      }
      if (companyKind) body.companyKind = companyKind;
      if (inviteChip) {
        body.chip = inviteChip;
        body.chipOther =
          inviteChip === "other" ? inviteChipOther.trim() || null : null;
      }
      await invite.mutateAsync({ data: body });
      setIdentifier("");
      setInviteChip("");
      setInviteChipOther("");
      await queryClient.invalidateQueries({ queryKey: getListMyTeamQueryKey() });
    } catch (e) {
      Alert.alert("Invite failed", e instanceof Error ? e.message : "Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRemove(memberClerkId: string, name: string) {
    // #627: Use the cross-platform confirm helper so the dialog actually
    // surfaces on react-native-web and native alike.
    const proceed = await confirm({
      title: "Remove from team?",
      message: `Remove ${name} from your team?`,
      confirmLabel: "Remove",
      cancelLabel: "Cancel",
      destructive: true,
    });
    if (!proceed) return;
    await remove.mutateAsync({ memberClerkId });
    await queryClient.invalidateQueries({ queryKey: getListMyTeamQueryKey() });
  }

  async function handleSaveChip() {
    if (!chipEditFor) return;
    try {
      await updateChip.mutateAsync({
        memberClerkId: chipEditFor.memberClerkId,
        data: {
          chip: chipEditFor.chip || null,
          chipOther:
            chipEditFor.chip === "other"
              ? chipEditFor.chipOther.trim() || null
              : null,
          companyKind: companyKind ?? null,
        },
      });
      await queryClient.invalidateQueries({ queryKey: getListMyTeamQueryKey() });
      setChipEditFor(null);
    } catch (e) {
      Alert.alert(
        "Could not save chip",
        e instanceof Error ? e.message : "Try again.",
      );
    }
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={[s.root, { backgroundColor: colors.background }]}>
        <View
          style={[
            s.header,
            { borderBottomColor: colors.border, paddingTop: Platform.OS === "web" ? 24 : insets.top + 8 },
          ]}
        >
          <Pressable onPress={onClose} hitSlop={20} style={{ padding: 8 }}>
            <Feather name="x" size={22} color={colors.foreground} />
          </Pressable>
          <Text style={[s.title, { color: colors.foreground }]}>Manage team</Text>
          <View style={{ width: 38 }} />
        </View>

        <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 32, gap: 16 }}>
          <View style={{ gap: 8 }}>
            <Text style={[s.label, { color: colors.mutedForeground }]}>INVITE BY USERNAME OR EMAIL</Text>
            <TextInput
              value={identifier}
              onChangeText={setIdentifier}
              placeholder="@username or someone@email.com"
              placeholderTextColor={colors.mutedForeground}
              autoCapitalize="none"
              autoCorrect={false}
              style={[
                s.input,
                { color: colors.foreground, backgroundColor: colors.card, borderColor: colors.border },
              ]}
            />
            <View style={s.roleRow}>
              {ROLE_OPTIONS.map((opt) => {
                const active = role === opt.value;
                return (
                  <Pressable
                    key={opt.value}
                    onPress={() => setRole(opt.value)}
                    style={[
                      s.roleChip,
                      {
                        borderColor: active ? colors.primary : colors.border,
                        backgroundColor: active ? colors.primary + "20" : "transparent",
                      },
                    ]}
                  >
                    <Text
                      style={{
                        fontSize: 13,
                        fontFamily: "Inter_700Bold",
                        color: active ? colors.primary : colors.foreground,
                      }}
                    >
                      {opt.label}
                    </Text>
                    <Text
                      style={{
                        fontSize: 11,
                        fontFamily: "Inter_500Medium",
                        color: colors.mutedForeground,
                        marginTop: 2,
                      }}
                    >
                      {opt.subtitle}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            {chipOptions.length > 0 ? (
              <View style={{ gap: 8 }}>
                <Text style={[s.label, { color: colors.mutedForeground }]}>
                  CHIP (OPTIONAL)
                </Text>
                <View style={s.chipsWrap}>
                  {chipOptions.map((opt) => {
                    const active = inviteChip === opt.value;
                    return (
                      <Pressable
                        key={opt.value}
                        onPress={() =>
                          setInviteChip((prev) => (prev === opt.value ? "" : opt.value))
                        }
                        style={[
                          s.pill,
                          {
                            borderColor: active ? colors.primary : colors.border,
                            backgroundColor: active ? colors.primary + "20" : colors.card,
                          },
                        ]}
                      >
                        <Text
                          style={{
                            fontSize: 13,
                            fontFamily: "Inter_600SemiBold",
                            color: active ? colors.primary : colors.foreground,
                          }}
                        >
                          {opt.label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
                {inviteChip === "other" ? (
                  <TextInput
                    value={inviteChipOther}
                    onChangeText={setInviteChipOther}
                    placeholder="Describe…"
                    placeholderTextColor={colors.mutedForeground}
                    style={[
                      s.input,
                      { color: colors.foreground, backgroundColor: colors.card, borderColor: colors.border },
                    ]}
                  />
                ) : null}
              </View>
            ) : null}
            <Pressable
              onPress={handleInvite}
              disabled={submitting}
              style={[
                s.primary,
                {
                  backgroundColor: colors.primary,
                  opacity: submitting ? 0.6 : 1,
                },
              ]}
            >
              {submitting ? (
                <ActivityIndicator color={colors.primaryForeground ?? "#fff"} />
              ) : (
                <>
                  <Feather name="user-plus" size={16} color={colors.primaryForeground ?? "#fff"} />
                  <Text style={[s.primaryText, { color: colors.primaryForeground ?? "#fff" }]}>
                    Send invite
                  </Text>
                </>
              )}
            </Pressable>
            <Text style={{ color: colors.mutedForeground, fontSize: 12, fontFamily: "Inter_500Medium" }}>
              Invitees must accept before they appear on your public profile.
            </Text>
          </View>

          {isFetching && members.length === 0 ? (
            <ActivityIndicator color={colors.foreground} />
          ) : (
            <TeamSection
              members={members.map((m) => ({
                memberClerkId: m.memberClerkId,
                name: m.name,
                username: m.username,
                avatarUrl: m.avatarUrl,
                role: m.role,
                status: m.status,
                chip: m.chip ?? null,
                chipOther: m.chipOther ?? null,
              }))}
              companyKind={companyKind ?? null}
              editable
            />
          )}

          {members.length > 0 && chipOptions.length > 0 ? (
            <View style={{ gap: 6 }}>
              <Text style={[s.label, { color: colors.mutedForeground }]}>
                TEAMMATE CHIPS
              </Text>
              {members.map((m) => {
                const label = teammateChipLabel(
                  companyKind ?? null,
                  m.chip ?? null,
                  m.chipOther ?? null,
                );
                return (
                  <Pressable
                    key={`chip-${m.memberClerkId}`}
                    onPress={() =>
                      setChipEditFor({
                        memberClerkId: m.memberClerkId,
                        name: m.name,
                        chip: m.chip ?? "",
                        chipOther: m.chipOther ?? "",
                      })
                    }
                    style={[s.chipEditRow, { borderColor: colors.border }]}
                  >
                    <Text
                      style={{ color: colors.foreground, fontSize: 14, fontFamily: "Inter_500Medium", flex: 1 }}
                      numberOfLines={1}
                    >
                      {m.name}
                      <Text style={{ color: colors.mutedForeground }}>
                        {label ? ` · ${label}` : " · No chip"}
                      </Text>
                    </Text>
                    <Feather name="edit-2" size={14} color={colors.mutedForeground} />
                    <Text
                      style={{
                        color: colors.mutedForeground,
                        fontSize: 12,
                        fontFamily: "Inter_600SemiBold",
                        marginLeft: 4,
                      }}
                    >
                      Change chip
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          ) : null}

          {members.length > 0 ? (
            <View style={{ gap: 6 }}>
              <Text style={[s.label, { color: colors.mutedForeground }]}>REMOVE</Text>
              {members.map((m) => (
                <Pressable
                  key={m.memberClerkId}
                  onPress={() => handleRemove(m.memberClerkId, m.name)}
                  style={[s.removeRow, { borderColor: colors.border }]}
                >
                  <Text style={{ color: colors.foreground, fontSize: 14, fontFamily: "Inter_500Medium", flex: 1 }}>
                    {m.name}
                    <Text style={{ color: colors.mutedForeground }}> · @{m.username}</Text>
                  </Text>
                  <Feather name="trash-2" size={16} color={colors.destructive ?? "#c00"} />
                </Pressable>
              ))}
            </View>
          ) : null}
        </ScrollView>
      </View>

      <ChangeChipSheet
        visible={chipEditFor != null}
        onClose={() => setChipEditFor(null)}
        name={chipEditFor?.name ?? ""}
        chip={chipEditFor?.chip ?? ""}
        chipOther={chipEditFor?.chipOther ?? ""}
        options={chipOptions}
        saving={updateChip.isPending}
        onChangeChip={(v) =>
          setChipEditFor((prev) => (prev ? { ...prev, chip: v } : prev))
        }
        onChangeChipOther={(v) =>
          setChipEditFor((prev) => (prev ? { ...prev, chipOther: v } : prev))
        }
        onSave={handleSaveChip}
      />
    </Modal>
  );
}

function ChangeChipSheet({
  visible,
  onClose,
  name,
  chip,
  chipOther,
  options,
  saving,
  onChangeChip,
  onChangeChipOther,
  onSave,
}: {
  visible: boolean;
  onClose: () => void;
  name: string;
  chip: string;
  chipOther: string;
  options: readonly { value: string; label: string }[];
  saving: boolean;
  onChangeChip: (v: string) => void;
  onChangeChipOther: (v: string) => void;
  onSave: () => void;
}) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={[s.root, { backgroundColor: colors.background }]}>
        <View
          style={[
            s.header,
            { borderBottomColor: colors.border, paddingTop: Platform.OS === "web" ? 24 : insets.top + 8 },
          ]}
        >
          <Pressable onPress={onClose} hitSlop={20} style={{ padding: 8 }}>
            <Feather name="x" size={22} color={colors.foreground} />
          </Pressable>
          <Text style={[s.title, { color: colors.foreground }]}>Change chip</Text>
          <Pressable onPress={onSave} disabled={saving} hitSlop={20} style={{ padding: 8 }}>
            {saving ? (
              <ActivityIndicator size="small" color={colors.foreground} />
            ) : (
              <Text style={{ color: colors.primary, fontSize: 15, fontFamily: "Inter_700Bold" }}>
                Save
              </Text>
            )}
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: insets.bottom + 32 }}>
          <Text style={{ color: colors.mutedForeground, fontSize: 13, fontFamily: "Inter_500Medium" }}>
            For {name}
          </Text>
          <View style={s.chipsWrap}>
            <Pressable
              onPress={() => onChangeChip("")}
              style={[
                s.pill,
                {
                  borderColor: chip === "" ? colors.primary : colors.border,
                  backgroundColor: chip === "" ? colors.primary + "20" : colors.card,
                },
              ]}
            >
              <Text
                style={{
                  fontSize: 13,
                  fontFamily: "Inter_600SemiBold",
                  color: chip === "" ? colors.primary : colors.foreground,
                }}
              >
                No chip
              </Text>
            </Pressable>
            {options.map((opt) => {
              const active = chip === opt.value;
              return (
                <Pressable
                  key={opt.value}
                  onPress={() => onChangeChip(opt.value)}
                  style={[
                    s.pill,
                    {
                      borderColor: active ? colors.primary : colors.border,
                      backgroundColor: active ? colors.primary + "20" : colors.card,
                    },
                  ]}
                >
                  <Text
                    style={{
                      fontSize: 13,
                      fontFamily: "Inter_600SemiBold",
                      color: active ? colors.primary : colors.foreground,
                    }}
                  >
                    {opt.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          {chip === "other" ? (
            <TextInput
              value={chipOther}
              onChangeText={onChangeChipOther}
              placeholder="Describe…"
              placeholderTextColor={colors.mutedForeground}
              style={[
                s.input,
                { color: colors.foreground, backgroundColor: colors.card, borderColor: colors.border },
              ]}
            />
          ) : null}
        </ScrollView>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  title: { fontSize: 16, fontFamily: "Inter_700Bold" },
  label: { fontSize: 11, fontFamily: "Inter_700Bold", letterSpacing: 0.6 },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 15,
    fontFamily: "Inter_400Regular",
  },
  roleRow: { flexDirection: "row", gap: 8 },
  roleChip: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 10,
  },
  chipsWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  pill: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
  },
  primary: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
    borderRadius: 12,
  },
  primaryText: { fontSize: 15, fontFamily: "Inter_700Bold" },
  removeRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    gap: 8,
  },
  chipEditRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    gap: 6,
  },
});
