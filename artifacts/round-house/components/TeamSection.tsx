import React from "react";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { resolveStorageUrl } from "@/lib/uploads";
import { teammateChipLabel } from "@/lib/connectionTags";

export type TeamSectionMember = {
  memberClerkId: string;
  name: string;
  username: string;
  avatarUrl: string;
  role: "employee" | "manager" | "partner";
  // Two upstream APIs feed this component with different status vocabularies:
  //   - userTeamMembersTable (users.ts /users/me/team) emits "pending" | "accepted"
  //   - entityMembersTable (entities.ts /entities/:id/members) emits "invited" | "approved" | "requested" | "declined" | "removed"
  // We accept both and normalize visibility/pending below so neither surface
  // silently hides approved members behind the wrong string check.
  status?: "pending" | "accepted" | "invited" | "approved" | "requested" | "declined" | "removed";
  chip?: string | null;
  chipOther?: string | null;
};

const ROLE_LABEL: Record<TeamSectionMember["role"], string> = {
  employee: "Employee",
  manager: "Manager",
  partner: "Partner",
};

type Props = {
  members: TeamSectionMember[];
  editable?: boolean;
  onManage?: () => void;
  onMemberPress?: (clerkId: string) => void;
  /** #643 — open an inbox thread with this teammate. Suppressed for
   *  pending invites since there's no accepted account to message yet. */
  onMemberMessage?: (clerkId: string) => void;
  /** #502 — company kind for resolving teammate chip labels. */
  companyKind?: string | null;
};

export function TeamSection({ members, editable, onManage, onMemberPress, onMemberMessage, companyKind }: Props) {
  const colors = useColors();
  const visible = members.filter(
    (m) => !m.status || m.status === "accepted" || m.status === "approved",
  );
  const showItems = editable ? members : visible;

  return (
    <View style={{ gap: 8 }}>
      <View style={styles.headerRow}>
        <Text style={[styles.label, { color: colors.mutedForeground }]}>TEAM</Text>
        {editable ? (
          <Pressable hitSlop={10} onPress={onManage} style={styles.editBtn}>
            <Feather name="user-plus" size={12} color={colors.mutedForeground} />
            <Text style={[styles.editText, { color: colors.mutedForeground }]}>Manage</Text>
          </Pressable>
        ) : null}
      </View>

      {showItems.length === 0 ? (
        <Pressable
          onPress={onManage}
          disabled={!editable}
          style={[styles.emptyBox, { backgroundColor: colors.card, borderColor: colors.border }]}
        >
          <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
            {editable
              ? "Invite employees, managers, or partners to your team."
              : "No team members listed."}
          </Text>
        </Pressable>
      ) : (
        (["manager", "partner", "employee"] as const).map((role) => {
          const groupItems = showItems.filter((m) => m.role === role);
          if (groupItems.length === 0) return null;
          const groupTitle =
            role === "manager" ? "Managers" : role === "partner" ? "Partners" : "Employees";
          return (
            <View key={role} style={{ gap: 6 }}>
              <Text style={[styles.groupLabel, { color: colors.mutedForeground }]}>
                {groupTitle.toUpperCase()}
              </Text>
              <View style={[styles.list, { backgroundColor: colors.card, borderColor: colors.border }]}>
                {groupItems.map((m, idx) => {
                  const avatar = resolveStorageUrl(m.avatarUrl ?? null, null);
                  const isPending = m.status === "pending" || m.status === "invited" || m.status === "requested";
                  const canMessage = !!onMemberMessage && !isPending;
                  return (
                    <Pressable
                      key={m.memberClerkId}
                      onPress={() => onMemberPress?.(m.memberClerkId)}
                      style={[
                        styles.row,
                        {
                          borderTopColor: colors.border,
                          borderTopWidth: idx === 0 ? 0 : StyleSheet.hairlineWidth,
                        },
                      ]}
                    >
                      <View style={[styles.avatar, { backgroundColor: colors.muted }]}>
                        {avatar ? (
                          <Image source={{ uri: avatar }} style={styles.avatarImg} />
                        ) : (
                          <Text style={[styles.avatarInitial, { color: colors.mutedForeground }]}>
                            {(m.name || "?").trim().charAt(0).toUpperCase()}
                          </Text>
                        )}
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.name, { color: colors.foreground }]} numberOfLines={1}>
                          {m.name}
                        </Text>
                        <Text
                          style={[styles.subtitle, { color: colors.mutedForeground }]}
                          numberOfLines={1}
                        >
                          @{m.username} · {ROLE_LABEL[m.role]}
                          {(() => {
                            const chip = teammateChipLabel(companyKind ?? null, m.chip ?? null, m.chipOther ?? null);
                            return chip ? ` · ${chip}` : "";
                          })()}
                          {isPending ? " · Pending" : ""}
                        </Text>
                      </View>
                      {/* #643 — Message affordance for accepted teammates. */}
                      {canMessage ? (
                        <Pressable
                          onPress={(e) => {
                            e.stopPropagation();
                            onMemberMessage?.(m.memberClerkId);
                          }}
                          accessibilityRole="button"
                          accessibilityLabel={`Message ${m.name}`}
                          hitSlop={6}
                          style={({ pressed }) => [
                            styles.messageBtn,
                            {
                              backgroundColor: colors.muted,
                              borderColor: colors.border,
                              opacity: pressed ? 0.7 : 1,
                            },
                          ]}
                        >
                          <Feather name="message-circle" size={13} color={colors.foreground} />
                          <Text style={[styles.messageBtnText, { color: colors.foreground }]}>
                            Message
                          </Text>
                        </Pressable>
                      ) : null}
                    </Pressable>
                  );
                })}
              </View>
            </View>
          );
        })
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  label: { fontSize: 11, fontFamily: "Inter_700Bold", letterSpacing: 0.8 },
  groupLabel: { fontSize: 11, fontFamily: "Inter_700Bold", letterSpacing: 0.8, paddingHorizontal: 4 },
  editBtn: { flexDirection: "row", alignItems: "center", gap: 4 },
  editText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  list: { borderRadius: 16, borderWidth: 1, paddingHorizontal: 12 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    gap: 12,
  },
  avatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  avatarImg: { width: "100%", height: "100%" },
  avatarInitial: { fontSize: 16, fontFamily: "Inter_700Bold" },
  name: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  subtitle: { fontSize: 12, fontFamily: "Inter_500Medium", marginTop: 2 },
  emptyBox: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
  },
  emptyText: { fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 18 },
  messageBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    minHeight: 30,
  },
  messageBtnText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
});
