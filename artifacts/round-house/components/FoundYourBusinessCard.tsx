/**
 * FoundYourBusinessCard — Profile on-ramp for creating a real Business Entity.
 *
 * A user may create a Business Entity either as its Owner or as Temporary
 * Admin. Temporary Admin is an authority state for an unclaimed business; it
 * does not assert ownership. This on-ramp is available from the neutral Viewer
 * fallback too, so an unaffiliated user is never trapped in a functionless
 * Viewer state with no way to establish an Entity.
 */
import React, { useEffect, useState } from "react";
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

const BUSINESS_SETUP_KINDS = new Set([
  "trade_pro",
  "facilities",
  "collab",
  "trade_pro_collab",
  "facilities_collab",
]);

type EntityMembership = {
  role?: string | null;
  permissions?: {
    scope?: {
      creationCapacity?: string;
      temporaryAdmin?: boolean;
      unclaimed?: boolean;
    } | null;
  } | null;
};

type EntityRow = {
  id: number;
  kind: string;
  displayName?: string;
  name?: string;
  isAdminDemo: boolean;
  myMembership?: EntityMembership | null;
};

type ListEntitiesResponse = {
  entities: EntityRow[];
};

export type EntityCreationCapacity = "owner" | "temporary_admin";

const ENTITIES_MINE_KEY = ["/api/entities/mine"] as const;

export function FoundYourBusinessCard() {
  const colors = useColors();
  const { activeOutwardAccount } = useProfile();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);

  const canStartBusiness = BUSINESS_SETUP_KINDS.has(
    activeOutwardAccount?.kind ?? "",
  );

  const { data, isLoading } = useQuery({
    enabled: canStartBusiness,
    queryKey: ENTITIES_MINE_KEY,
    queryFn: () => customFetch<ListEntitiesResponse>("/api/entities/mine"),
  });

  const business = (data?.entities ?? []).find((e) => e.kind === "business") ?? null;

  if (!canStartBusiness) return null;
  if (isLoading) return null;

  if (business) {
    const capacity =
      business.myMembership?.permissions?.scope?.creationCapacity ??
      (business.myMembership?.role === "owner" ? "owner" : "temporary_admin");
    const label = capacity === "temporary_admin" ? "Temporary Admin" : "Owner";
    const unclaimed = business.myMembership?.permissions?.scope?.unclaimed === true;
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
            {business.displayName || business.name || "Business"}
          </Text>
          <Text style={[styles.blurb, { color: colors.mutedForeground }]}>
            Business Entity · {label}{unclaimed ? " · Unclaimed" : ""}
          </Text>
          <Text style={[styles.entityNote, { color: colors.mutedForeground }]}>
            This Business is attached to your Profile and available to RoundHouse Entity tools.
          </Text>
        </View>
      </View>
    );
  }

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
        <Text style={[styles.title, { color: colors.foreground }]}>Set up a Business</Text>
        <Text style={[styles.blurb, { color: colors.mutedForeground }]}>
          Create the actual Business Entity as its Owner or Temporary Admin.
        </Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => setOpen(true)}
          style={({ pressed }) => [
            styles.button,
            { backgroundColor: colors.primary, opacity: pressed ? 0.85 : 1 },
          ]}
        >
          <Text style={styles.buttonText}>+ Add Business</Text>
        </Pressable>
      </View>

      <FoundYourBusinessModal
        visible={open}
        onClose={() => setOpen(false)}
        onCreated={() => {
          void queryClient.invalidateQueries({ queryKey: ENTITIES_MINE_KEY });
          setOpen(false);
        }}
      />
    </View>
  );
}

export function FoundYourBusinessModal({
  visible,
  onClose,
  onCreated,
  initialName = "",
}: {
  visible: boolean;
  onClose: () => void;
  onCreated: () => void;
  initialName?: string;
}) {
  const colors = useColors();
  const { activeOutwardAccount } = useProfile();
  const isDemo = !!activeOutwardAccount?.isDemo;
  const [capacity, setCapacity] = useState<EntityCreationCapacity>("owner");
  const [displayName, setDisplayName] = useState(initialName);
  const [legalName, setLegalName] = useState("");
  const [tagline, setTagline] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setDisplayName(initialName);
    setCapacity("owner");
    setError(null);
  }, [visible, initialName]);

  const create = useMutation({
    mutationFn: async () => {
      const trimmed = displayName.trim();
      if (!trimmed) throw new Error("Business name is required");
      return customFetch<EntityRow>("/api/entity-setup/business", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          displayName: trimmed,
          legalName: legalName.trim() || undefined,
          tagline: tagline.trim() || undefined,
          creationCapacity: capacity,
        }),
      });
    },
    onError: (err: unknown) => {
      setError(err instanceof Error ? err.message : "Could not create business");
    },
    onSuccess: () => {
      setDisplayName("");
      setLegalName("");
      setTagline("");
      setCapacity("owner");
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
    <Modal transparent animationType="fade" visible={visible} onRequestClose={handleClose}>
      <View style={styles.modalBackdrop}>
        <View
          style={[
            styles.modalCard,
            { backgroundColor: colors.background, borderColor: colors.border },
          ]}
        >
          <View style={styles.modalHeader}>
            <Text style={[styles.modalTitle, { color: colors.foreground }]}>Set up Business</Text>
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

          <Text style={[styles.modalBlurb, { color: colors.mutedForeground }]}>
            Create the real Business Entity and choose how you are establishing it.
          </Text>

          <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>SETUP AUTHORITY</Text>
          <View style={styles.capacityRow}>
            <CapacityButton
              selected={capacity === "owner"}
              title="Owner"
              subtitle="I own this business"
              onPress={() => setCapacity("owner")}
              colors={colors}
            />
            <CapacityButton
              selected={capacity === "temporary_admin"}
              title="Temporary Admin"
              subtitle="I’m setting it up for its owner"
              onPress={() => setCapacity("temporary_admin")}
              colors={colors}
            />
          </View>

          <Field
            label="Business name"
            required
            colors={colors}
            value={displayName}
            onChangeText={setDisplayName}
            placeholder="e.g. DMT DESIGN BUILD"
            autoFocus={!initialName}
          />
          <Field
            label="Legal name (optional)"
            colors={colors}
            value={legalName}
            onChangeText={setLegalName}
            placeholder="e.g. DMT Design Build LLC"
          />
          <Field
            label="Tagline (optional)"
            colors={colors}
            value={tagline}
            onChangeText={setTagline}
            placeholder="One line about the business"
          />

          {capacity === "temporary_admin" ? (
            <Text style={[styles.capacityNote, { color: colors.mutedForeground }]}>
              This Business will be treated as unclaimed until its legitimate Owner takes control.
            </Text>
          ) : null}

          {error ? <Text style={[styles.error, { color: colors.destructive }]}>{error}</Text> : null}

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
              <Text style={[styles.secondaryBtnText, { color: colors.foreground }]}>Cancel</Text>
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
                    pressed || create.isPending || displayName.trim().length === 0 ? 0.7 : 1,
                },
              ]}
            >
              {create.isPending ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.primaryBtnText}>Create Business</Text>
              )}
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function CapacityButton({
  selected,
  title,
  subtitle,
  onPress,
  colors,
}: {
  selected: boolean;
  title: string;
  subtitle: string;
  onPress: () => void;
  colors: ReturnType<typeof useColors>;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.capacityButton,
        {
          borderColor: selected ? colors.primary : colors.border,
          backgroundColor: selected ? colors.scoreBackground : colors.card,
          opacity: pressed ? 0.8 : 1,
        },
      ]}
    >
      <Text style={[styles.capacityTitle, { color: colors.foreground }]}>{title}</Text>
      <Text style={[styles.capacitySubtitle, { color: colors.mutedForeground }]}>{subtitle}</Text>
    </Pressable>
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
  title: { fontSize: 16, fontFamily: "Inter_700Bold" },
  blurb: { fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 18 },
  entityNote: { fontSize: 11, fontFamily: "Inter_400Regular", lineHeight: 15 },
  button: {
    alignSelf: "flex-start",
    marginTop: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
  },
  buttonText: { color: "#fff", fontSize: 13, fontFamily: "Inter_600SemiBold" },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
  },
  modalCard: {
    width: "100%",
    maxWidth: 500,
    borderRadius: 14,
    borderWidth: 1,
    padding: 18,
    gap: 12,
  },
  modalHeader: { flexDirection: "row", alignItems: "center", gap: 8 },
  modalTitle: { fontSize: 18, fontFamily: "Inter_700Bold", flexShrink: 1 },
  modalClose: { marginLeft: "auto" },
  modalBlurb: { fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 18 },
  capacityRow: { flexDirection: "row", gap: 8 },
  capacityButton: {
    flex: 1,
    minHeight: 66,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 9,
    justifyContent: "center",
  },
  capacityTitle: { fontSize: 13, fontFamily: "Inter_700Bold" },
  capacitySubtitle: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 2, lineHeight: 15 },
  capacityNote: { fontSize: 11, fontFamily: "Inter_400Regular", lineHeight: 16 },
  field: { gap: 4 },
  fieldLabel: { fontSize: 12, fontFamily: "Inter_500Medium" },
  input: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: Platform.OS === "ios" ? 10 : 8,
    fontSize: 14,
    fontFamily: "Inter_400Regular",
  },
  error: { fontSize: 12, fontFamily: "Inter_500Medium" },
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
  secondaryBtnText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  primaryBtn: {
    paddingHorizontal: 18,
    paddingVertical: 9,
    borderRadius: 8,
    minWidth: 120,
    alignItems: "center",
  },
  primaryBtnText: { color: "#fff", fontSize: 13, fontFamily: "Inter_600SemiBold" },
});