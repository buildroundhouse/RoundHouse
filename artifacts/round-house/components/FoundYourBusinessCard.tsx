/**
 * FoundYourBusinessCard — empty-state card shown on the Profile tab
 * when the active avatar is a Trade Pro / Facilities account that
 * hasn't founded a business entity yet.
 *
 * Rendered inline in the regular profile flow (option (c) chosen by
 * the founder) — no admin-only path. The same card appears for real
 * users and for demo avatars; the only difference is that anything
 * created from a demo avatar is auto-stamped `is_admin_demo = true`
 * by the server and surfaces a "DEMO" badge in every UI surface.
 *
 * If the avatar HAS founded one or more entities, the card hides itself
 * (this is purely an empty-state nudge — once a business exists, the
 * primary surface for managing it lives elsewhere).
 */
import React, { useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { useColors } from "@/hooks/useColors";
import { useProfile } from "@/lib/profile";
import { DemoBadge } from "@/components/DemoBadge";

const BUSINESS_AVATAR_KINDS = new Set(["trade_pro", "facilities"]);

type EntityRow = {
  id: number;
  kind: string;
  displayName: string;
  isAdminDemo: boolean;
};

type ListEntitiesResponse = {
  entities: EntityRow[];
};

const ENTITIES_MINE_KEY = ["/api/entities/mine"] as const;

export function FoundYourBusinessCard() {
  const colors = useColors();
  const { activeOutwardAccount } = useProfile();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);

  const isBusinessAvatar = BUSINESS_AVATAR_KINDS.has(
    activeOutwardAccount?.kind ?? "",
  );

  const { data, isLoading } = useQuery({
    enabled: isBusinessAvatar,
    queryKey: ENTITIES_MINE_KEY,
    queryFn: () => customFetch<ListEntitiesResponse>("/api/entities/mine"),
  });

  // Hide entirely when this avatar isn't business-eligible OR already
  // controls one or more entities. We never want to nag a user who
  // already founded their business — this card is purely the on-ramp.
  if (!isBusinessAvatar) return null;
  if (isLoading) return null;
  if ((data?.entities ?? []).length > 0) return null;

  return (
    <View
      style={[
        styles.card,
        { backgroundColor: colors.card, borderColor: colors.border },
      ]}
    >
      <View style={styles.iconWrap}>
        <View
          style={[
            styles.iconCircle,
            { backgroundColor: colors.scoreBackground ?? colors.muted },
          ]}
        >
          <Feather name="briefcase" size={18} color={colors.primary} />
        </View>
      </View>
      <View style={styles.body}>
        <Text style={[styles.title, { color: colors.foreground }]}>
          Found your business
        </Text>
        <Text style={[styles.blurb, { color: colors.mutedForeground }]}>
          Set up your business profile so you can be hired, manage clients,
          and bring your team in. You can edit everything later.
        </Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => setOpen(true)}
          style={({ pressed }) => [
            styles.button,
            { backgroundColor: colors.primary, opacity: pressed ? 0.85 : 1 },
          ]}
        >
          <Text style={styles.buttonText}>Get started</Text>
        </Pressable>
      </View>

      <FoundYourBusinessModal
        visible={open}
        onClose={() => setOpen(false)}
        onCreated={() => {
          queryClient.invalidateQueries({ queryKey: ENTITIES_MINE_KEY });
          setOpen(false);
        }}
      />
    </View>
  );
}

function FoundYourBusinessModal({
  visible,
  onClose,
  onCreated,
}: {
  visible: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const colors = useColors();
  const { activeOutwardAccount } = useProfile();
  const isDemo = !!activeOutwardAccount?.isDemo;
  const [displayName, setDisplayName] = useState("");
  const [legalName, setLegalName] = useState("");
  const [tagline, setTagline] = useState("");
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: async () => {
      const trimmed = displayName.trim();
      if (!trimmed) throw new Error("Business name is required");
      return customFetch<EntityRow>("/api/entities", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "business",
          displayName: trimmed,
          legalName: legalName.trim() || undefined,
          tagline: tagline.trim() || undefined,
        }),
      });
    },
    onError: (err: unknown) => {
      const msg =
        err instanceof Error ? err.message : "Could not create business";
      setError(msg);
    },
    onSuccess: () => {
      setDisplayName("");
      setLegalName("");
      setTagline("");
      setError(null);
      onCreated();
    },
  });

  const handleClose = () => {
    if (create.isPending) return;
    setError(null);
    onClose();
  };

  return (
    <Modal
      transparent
      animationType="fade"
      visible={visible}
      onRequestClose={handleClose}
    >
      <View style={styles.modalBackdrop}>
        <View
          style={[
            styles.modalCard,
            { backgroundColor: colors.background, borderColor: colors.border },
          ]}
        >
          <View style={styles.modalHeader}>
            <Text style={[styles.modalTitle, { color: colors.foreground }]}>
              Found your business
            </Text>
            {isDemo ? <DemoBadge size="md" /> : null}
            <Pressable
              hitSlop={10}
              onPress={handleClose}
              style={styles.modalClose}
              accessibilityLabel="Close"
            >
              <Feather name="x" size={20} color={colors.mutedForeground} />
            </Pressable>
          </View>

          <Text
            style={[styles.modalBlurb, { color: colors.mutedForeground }]}
          >
            You'll be the founding owner. You can invite teammates from the
            business profile after it's created.
          </Text>

          <Field
            label="Business name"
            required
            colors={colors}
            value={displayName}
            onChangeText={setDisplayName}
            placeholder="e.g. Acme Plumbing"
            autoFocus
          />
          <Field
            label="Legal name (optional)"
            colors={colors}
            value={legalName}
            onChangeText={setLegalName}
            placeholder="e.g. Acme Plumbing LLC"
          />
          <Field
            label="Tagline (optional)"
            colors={colors}
            value={tagline}
            onChangeText={setTagline}
            placeholder="One line about your business"
          />

          {error ? (
            <Text style={[styles.error, { color: colors.destructive }]}>
              {error}
            </Text>
          ) : null}

          <View style={styles.modalActions}>
            <Pressable
              accessibilityRole="button"
              onPress={handleClose}
              disabled={create.isPending}
              style={({ pressed }) => [
                styles.secondaryBtn,
                {
                  borderColor: colors.border,
                  opacity: pressed || create.isPending ? 0.6 : 1,
                },
              ]}
            >
              <Text
                style={[styles.secondaryBtnText, { color: colors.foreground }]}
              >
                Cancel
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={() => create.mutate()}
              disabled={create.isPending || displayName.trim().length === 0}
              style={({ pressed }) => [
                styles.primaryBtn,
                {
                  backgroundColor: colors.primary,
                  opacity:
                    pressed || create.isPending || displayName.trim().length === 0
                      ? 0.7
                      : 1,
                },
              ]}
            >
              {create.isPending ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.primaryBtnText}>Create</Text>
              )}
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function Field({
  label,
  required,
  colors,
  value,
  onChangeText,
  placeholder,
  autoFocus,
}: {
  label: string;
  required?: boolean;
  colors: ReturnType<typeof useColors>;
  value: string;
  onChangeText: (s: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  return (
    <View style={styles.field}>
      <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>
        {label}
        {required ? " *" : ""}
      </Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.mutedForeground}
        autoFocus={autoFocus}
        style={[
          styles.input,
          {
            color: colors.foreground,
            backgroundColor: colors.card,
            borderColor: colors.border,
          },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: "row",
    gap: 12,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    marginHorizontal: 16,
    marginVertical: 10,
  },
  iconWrap: { paddingTop: 2 },
  iconCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  body: { flex: 1, gap: 6 },
  title: {
    fontSize: 16,
    fontFamily: "Inter_700Bold",
  },
  blurb: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    lineHeight: 18,
  },
  button: {
    alignSelf: "flex-start",
    marginTop: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
  },
  buttonText: {
    color: "#fff",
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
  },

  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
  },
  modalCard: {
    width: "100%",
    maxWidth: 460,
    borderRadius: 14,
    borderWidth: 1,
    padding: 18,
    gap: 12,
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  modalTitle: {
    fontSize: 18,
    fontFamily: "Inter_700Bold",
    flexShrink: 1,
  },
  modalClose: {
    marginLeft: "auto",
  },
  modalBlurb: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    lineHeight: 18,
  },
  field: { gap: 4 },
  fieldLabel: {
    fontSize: 12,
    fontFamily: "Inter_500Medium",
  },
  input: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: Platform.OS === "ios" ? 10 : 8,
    fontSize: 14,
    fontFamily: "Inter_400Regular",
  },
  error: {
    fontSize: 12,
    fontFamily: "Inter_500Medium",
  },
  modalActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 8,
    marginTop: 6,
  },
  secondaryBtn: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 8,
    borderWidth: 1,
  },
  secondaryBtnText: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
  },
  primaryBtn: {
    paddingHorizontal: 18,
    paddingVertical: 9,
    borderRadius: 8,
    minWidth: 90,
    alignItems: "center",
  },
  primaryBtnText: {
    color: "#fff",
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
  },
});
