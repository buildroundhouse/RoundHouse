import React, { useState } from "react";
import {
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import type { PropertyMember } from "@workspace/api-client-react";
import * as Haptics from "expo-haptics";
import { confirm as crossPlatformConfirm } from "@/lib/confirm";

interface Props {
  visible: boolean;
  onClose: () => void;
  members: PropertyMember[];
  currentOwnerClerkId: string;
  onTransfer: (newOwnerClerkId: string) => Promise<void>;
}

export function TransferOwnershipModal({
  visible,
  onClose,
  members,
  currentOwnerClerkId,
  onTransfer,
}: Props) {
  const colors = useColors();
  const [submitting, setSubmitting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const eligible = members.filter(
    (m) => m.userClerkId !== currentOwnerClerkId && !m.archivedAt,
  );

  const confirmAndTransfer = async (member: PropertyMember) => {
    const name = member.user?.name || member.user?.email || "this member";
    const message =
      "You will remain on the property as an admin. You can be removed later if needed. " +
      "All data — timeline, photos, notes, history — stays unchanged.";

    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    }
    // #627: Route the destructive confirm through `lib/confirm.ts` so
    // the dialog actually surfaces on react-native-web and native alike.
    const ok = await crossPlatformConfirm({
      title: `Make ${name} the new Owner?`,
      message,
      confirmLabel: "Transfer",
      cancelLabel: "Cancel",
      destructive: true,
    });
    if (!ok) return;
    try {
      setSubmitting(member.userClerkId);
      setError(null);
      await onTransfer(member.userClerkId);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not transfer ownership");
    } finally {
      setSubmitting(null);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <TouchableOpacity onPress={onClose}>
            <Text style={[styles.cancel, { color: colors.mutedForeground }]}>Cancel</Text>
          </TouchableOpacity>
          <Text style={[styles.title, { color: colors.foreground }]}>Transfer Ownership</Text>
          <View style={{ width: 56 }} />
        </View>

        <ScrollView contentContainerStyle={styles.body}>
          <Text style={[styles.intro, { color: colors.mutedForeground }]}>
            Choose a member to make the new Owner. You will remain on the property as an admin
            unless removed. All property data stays unchanged.
          </Text>

          {error ? (
            <Text style={[styles.error, { color: colors.destructive }]}>{error}</Text>
          ) : null}

          {eligible.length === 0 ? (
            <View style={[styles.empty, { borderColor: colors.border }]}>
              <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
                Invite another member to the property first, then you can transfer ownership.
              </Text>
            </View>
          ) : (
            <View style={{ gap: 8 }}>
              {eligible.map((m) => {
                const name = m.user?.name || m.user?.email || "Member";
                const sub = m.user?.email && m.user?.name ? m.user.email : m.role;
                const busy = submitting === m.userClerkId;
                return (
                  <Pressable
                    key={m.userClerkId}
                    disabled={!!submitting}
                    onPress={() => confirmAndTransfer(m)}
                    style={[
                      styles.row,
                      { backgroundColor: colors.card, borderColor: colors.border, opacity: busy ? 0.6 : 1 },
                    ]}
                  >
                    <View style={[styles.avatar, { backgroundColor: colors.primary + "30" }]}>
                      <Text style={[styles.avatarText, { color: colors.primary }]}>
                        {name[0].toUpperCase()}
                      </Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.name, { color: colors.foreground }]} numberOfLines={1}>
                        {name}
                      </Text>
                      <Text style={[styles.sub, { color: colors.mutedForeground }]} numberOfLines={1}>
                        {sub}
                      </Text>
                    </View>
                    <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
                  </Pressable>
                );
              })}
            </View>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  cancel: { fontSize: 16, fontFamily: "Inter_400Regular", minWidth: 56 },
  title: { fontSize: 17, fontFamily: "Inter_600SemiBold" },
  body: { padding: 20, gap: 14 },
  intro: { fontSize: 14, fontFamily: "Inter_400Regular", lineHeight: 20 },
  error: { fontSize: 13, fontFamily: "Inter_500Medium" },
  empty: {
    padding: 16,
    borderWidth: 1,
    borderStyle: "dashed",
    borderRadius: 10,
    alignItems: "center",
  },
  emptyText: { fontSize: 13, fontFamily: "Inter_400Regular", textAlign: "center" },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  avatar: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  avatarText: { fontSize: 15, fontFamily: "Inter_700Bold" },
  name: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  sub: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
});
