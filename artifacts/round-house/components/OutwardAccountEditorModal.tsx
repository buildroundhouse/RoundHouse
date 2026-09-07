import React, { useState } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useQueryClient } from "@tanstack/react-query";
import { useColors } from "@/hooks/useColors";
import { useProfile } from "@/lib/profile";
import {
  useCreateOutwardAccount,
  useUpdateOutwardAccount,
  type OutwardAccount,
} from "@workspace/api-client-react";
import {
  OutwardAccountForm,
  type OutwardAccountFormValues,
} from "./OutwardAccountForm";

export type OutwardAccountEditorMode =
  | { kind: "create" }
  | { kind: "edit"; account: OutwardAccount };

type Props = {
  visible: boolean;
  mode: OutwardAccountEditorMode;
  onClose: () => void;
  onSaved?: (saved: OutwardAccount) => void;
};

/**
 * In-place create / edit dialog for an outward-facing account ("public
 * profile"). Renders the shared `OutwardAccountForm` inside a modal so
 * the user never leaves the switcher overlay.
 */
export function OutwardAccountEditorModal({
  visible,
  mode,
  onClose,
  onSaved,
}: Props) {
  const colors = useColors();
  const queryClient = useQueryClient();
  const { refetchOutwardAccounts, refetchProfile, outwardAccounts } =
    useProfile();
  const createMutation = useCreateOutwardAccount();
  const updateMutation = useUpdateOutwardAccount();

  // First-ever account auto-activates so the user has a working header
  // immediately. Established users default to "leave my active alone".
  const [activate, setActivate] = useState(outwardAccounts.length === 0);

  const initial: OutwardAccountFormValues =
    mode.kind === "edit"
      ? {
          kind: mode.account.kind,
          title: mode.account.title ?? "",
          displayName: mode.account.displayName ?? "",
          bannerUrl: mode.account.bannerUrl ?? null,
          companyName: mode.account.companyName ?? "",
          bio: mode.account.bio ?? "",
          // #640 — Hydrate per-skin "show last initial only" toggle
          // from the server payload. Default OFF for legacy / undefined.
          lastInitialOnly: !!mode.account.lastInitialOnly,
        }
      : {
          kind: "home",
          title: "",
          displayName: "",
          bannerUrl: null,
          companyName: "",
          bio: "",
          // #640 — Owner-kind defaults to OFF so the first-time create
          // sheet doesn't silently shorten the name; the toggle is
          // visible right above Save if they want to flip it.
          lastInitialOnly: false,
        };

  const onSubmit = async (values: OutwardAccountFormValues) => {
    if (mode.kind === "create") {
      const created = await createMutation.mutateAsync({
        data: {
          kind: values.kind,
          title: values.title,
          displayName: values.displayName,
          bannerUrl: values.bannerUrl,
          companyName: values.companyName.trim()
            ? values.companyName.trim()
            : null,
          bio: values.bio.trim() ? values.bio.trim() : null,
          lastInitialOnly: values.lastInitialOnly,
          makeActive: activate,
        },
      });
      await Promise.all([refetchOutwardAccounts(), refetchProfile()]);
      if (activate) {
        // Re-scope every other read in the app to the new persona.
        await queryClient.invalidateQueries();
      }
      onSaved?.(created);
      onClose();
    } else {
      const updated = await updateMutation.mutateAsync({
        id: mode.account.id,
        data: {
          title: values.title,
          displayName: values.displayName,
          bannerUrl: values.bannerUrl,
          companyName: values.companyName.trim()
            ? values.companyName.trim()
            : null,
          bio: values.bio.trim() ? values.bio.trim() : null,
          lastInitialOnly: values.lastInitialOnly,
        },
      });
      await Promise.all([refetchOutwardAccounts(), refetchProfile()]);
      onSaved?.(updated);
      onClose();
    }
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      onRequestClose={onClose}
      presentationStyle="formSheet"
    >
      <View style={[styles.root, { backgroundColor: colors.background }]}>
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <Pressable
            onPress={onClose}
            hitSlop={12}
            accessibilityLabel="Close editor"
            style={styles.closeBtn}
          >
            <Feather name="x" size={22} color={colors.foreground} />
          </Pressable>
          <Text style={[styles.title, { color: colors.foreground }]}>
            {mode.kind === "create" ? "New public profile" : "Edit profile"}
          </Text>
          <View style={styles.closeBtn} />
        </View>
        <OutwardAccountForm
          initial={initial}
          lockKind={mode.kind === "edit"}
          submitLabel={mode.kind === "create" ? "Create profile" : "Save changes"}
          onSubmit={onSubmit}
          onCancel={onClose}
          showActivateToggle={mode.kind === "create"}
          activate={activate}
          onActivateChange={setActivate}
        />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  closeBtn: { padding: 4, width: 30 },
  title: { fontSize: 16, fontFamily: "Inter_700Bold" },
});
