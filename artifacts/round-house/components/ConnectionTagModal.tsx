import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
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
import { useColors } from "@/hooks/useColors";
import {
  CADENCE_OPTIONS,
  CLASSIFICATION_OPTIONS,
  COLLABORATOR_CHIP_OPTIONS,
  ON_SITE_IDENTITY_OPTIONS,
  type Cadence,
  type Classification,
  type CollaboratorChip,
  type OnSiteIdentity,
} from "@/lib/connectionTags";
import { useGetMe, useUpdateMyConnectionTag } from "@workspace/api-client-react";

/**
 * Task #502 — universal label + chip pattern.
 *
 * Single modal that drives all three flavors of tag editing:
 *   - mode = "classify-pro": homeowner / facility classifies a Trade
 *     Pro on the row they own (Worker / Outside service provider).
 *     Posts to the `from`-side connection row.
 *   - mode = "pro-self-tag": Trade Pro picks their own service title
 *     (from their existing Services chips) + on-site identity chip
 *     for this client. Posts to the `to`-side connection row that
 *     the client sees.
 *   - mode = "collaborator-self-tag": collaborator picks their own
 *     chip (Mom / Spouse / Friend / …) for this connection.
 *
 * The mode + the connectionId together are enough to PATCH; the
 * server enforces per-field authorization based on which side the
 * caller is on.
 */

export type ConnectionTagModalMode =
  | "classify-pro"
  | "pro-self-tag"
  | "collaborator-self-tag";

interface InitialTagValues {
  classification?: string | null;
  cadence?: string | null;
  serviceTitle?: string | null;
  onSiteIdentity?: string | null;
  onSiteIdentityOther?: string | null;
  chip?: string | null;
  chipOther?: string | null;
}

interface Props {
  visible: boolean;
  onClose: () => void;
  /** id of the user_connections row to patch (the one the caller owns). */
  connectionId: number | null;
  mode: ConnectionTagModalMode;
  initial?: InitialTagValues;
  /** Display name of the person being tagged — shown in the header. */
  subjectName?: string;
  onSaved?: () => void;
}

export function ConnectionTagModal({
  visible,
  onClose,
  connectionId,
  mode,
  initial,
  subjectName,
  onSaved,
}: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();

  // The pro-self-tag flow requires the caller to have at least one
  // service registered on their own profile. Per spec we show an
  // explicit error rather than letting them type free text — service
  // titles always come from the pro's own Services list.
  const { data: me } = useGetMe();
  const myServices = useMemo<string[]>(() => {
    const list = (me as { services?: { name?: string }[] } | undefined)
      ?.services;
    if (!Array.isArray(list)) return [];
    return list
      .map((s) => (typeof s?.name === "string" ? s.name.trim() : ""))
      .filter((s) => s.length > 0);
  }, [me]);

  const [classification, setClassification] = useState<Classification | "">("");
  const [cadence, setCadence] = useState<Cadence | "">("");
  const [serviceTitle, setServiceTitle] = useState<string>("");
  const [onSiteIdentity, setOnSiteIdentity] = useState<OnSiteIdentity | "">("");
  const [onSiteIdentityOther, setOnSiteIdentityOther] = useState<string>("");
  const [chip, setChip] = useState<CollaboratorChip | "">("");
  const [chipOther, setChipOther] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setClassification((initial?.classification as Classification | "") ?? "");
    setCadence((initial?.cadence as Cadence | "") ?? "");
    setServiceTitle(initial?.serviceTitle ?? "");
    setOnSiteIdentity((initial?.onSiteIdentity as OnSiteIdentity | "") ?? "");
    setOnSiteIdentityOther(initial?.onSiteIdentityOther ?? "");
    setChip((initial?.chip as CollaboratorChip | "") ?? "");
    setChipOther(initial?.chipOther ?? "");
    setError(null);
  }, [visible, initial]);

  const updateTag = useUpdateMyConnectionTag();

  async function handleSave() {
    if (connectionId == null) {
      setError("Connection not found");
      return;
    }
    setError(null);

    // Build the patch body for the active mode.
    const body: Record<string, unknown> = {};
    if (mode === "classify-pro") {
      if (!classification && !cadence) {
        setError("Pick a classification or cadence.");
        return;
      }
      if (classification) body.classification = classification;
      if (cadence) body.cadence = cadence;
    } else if (mode === "pro-self-tag") {
      if (myServices.length === 0) {
        setError(
          "Add at least one Service on your profile before tagging clients.",
        );
        return;
      }
      if (!serviceTitle) {
        setError("Pick a service title.");
        return;
      }
      body.serviceTitle = serviceTitle;
      body.onSiteIdentity = onSiteIdentity || null;
      body.onSiteIdentityOther =
        onSiteIdentity === "other" ? onSiteIdentityOther.trim() || null : null;
    } else {
      // collaborator-self-tag
      if (!chip) {
        setError("Pick a chip.");
        return;
      }
      body.chip = chip;
      body.chipOther = chip === "other" ? chipOther.trim() || null : null;
    }

    try {
      await updateTag.mutateAsync({ id: connectionId, data: body });
      onSaved?.();
      onClose();
    } catch (e) {
      const msg =
        e && typeof e === "object" && "message" in e
          ? String((e as { message: unknown }).message)
          : "Could not save";
      setError(msg);
    }
  }

  const title =
    mode === "classify-pro"
      ? "Classify"
      : mode === "pro-self-tag"
        ? "How do you show up?"
        : "Your tag";

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={[styles.root, { backgroundColor: colors.background }]}>
        <View
          style={[
            styles.header,
            { borderBottomColor: colors.border, paddingTop: Platform.OS === "web" ? 24 : insets.top + 8 },
          ]}
        >
          <Pressable onPress={onClose} hitSlop={20} style={{ padding: 8 }}>
            <Feather name="x" size={22} color={colors.foreground} />
          </Pressable>
          <Text style={[styles.title, { color: colors.foreground }]}>{title}</Text>
          <Pressable
            onPress={handleSave}
            disabled={updateTag.isPending}
            hitSlop={20}
            style={{ padding: 8 }}
          >
            {updateTag.isPending ? (
              <ActivityIndicator size="small" color={colors.foreground} />
            ) : (
              <Text style={[styles.save, { color: colors.primary }]}>Save</Text>
            )}
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 32 }]}>
          {subjectName ? (
            <Text style={[styles.subject, { color: colors.mutedForeground }]}>
              For {subjectName}
            </Text>
          ) : null}

          {mode === "classify-pro" ? (
            <>
              <Text style={[styles.section, { color: colors.foreground }]}>Classification</Text>
              <View style={{ gap: 8 }}>
                {CLASSIFICATION_OPTIONS.map((opt) => (
                  <RadioRow
                    key={opt.value}
                    selected={classification === opt.value}
                    onPress={() => setClassification(opt.value)}
                    label={opt.label}
                    help={opt.help}
                    colors={colors}
                  />
                ))}
              </View>
              <Text style={[styles.section, { color: colors.foreground, marginTop: 16 }]}>
                Cadence
              </Text>
              <View style={{ gap: 8 }}>
                {CADENCE_OPTIONS.map((opt) => (
                  <RadioRow
                    key={opt.value}
                    selected={cadence === opt.value}
                    onPress={() => setCadence(opt.value)}
                    label={opt.label}
                    help={opt.help}
                    colors={colors}
                  />
                ))}
              </View>
            </>
          ) : null}

          {mode === "pro-self-tag" ? (
            <>
              <Text style={[styles.section, { color: colors.foreground }]}>Service title</Text>
              {myServices.length === 0 ? (
                <Text style={[styles.helpError, { color: colors.destructive }]}>
                  You need at least one Service on your profile to tag clients.
                </Text>
              ) : (
                <View style={styles.chipsRow}>
                  {myServices.map((s) => (
                    <ChipPill
                      key={s}
                      label={s}
                      selected={serviceTitle === s}
                      onPress={() => setServiceTitle(s)}
                      colors={colors}
                    />
                  ))}
                </View>
              )}

              <Text style={[styles.section, { color: colors.foreground, marginTop: 16 }]}>
                On-site identity
              </Text>
              <View style={styles.chipsRow}>
                {ON_SITE_IDENTITY_OPTIONS.map((o) => (
                  <ChipPill
                    key={o.value}
                    label={o.label}
                    selected={onSiteIdentity === o.value}
                    onPress={() => setOnSiteIdentity(o.value)}
                    colors={colors}
                  />
                ))}
              </View>
              {onSiteIdentity === "other" ? (
                <TextInput
                  value={onSiteIdentityOther}
                  onChangeText={setOnSiteIdentityOther}
                  placeholder="Describe…"
                  placeholderTextColor={colors.mutedForeground}
                  style={[
                    styles.input,
                    { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.card },
                  ]}
                />
              ) : null}
            </>
          ) : null}

          {mode === "collaborator-self-tag" ? (
            <>
              <Text style={[styles.section, { color: colors.foreground }]}>Pick a chip</Text>
              <View style={styles.chipsRow}>
                {COLLABORATOR_CHIP_OPTIONS.map((o) => (
                  <ChipPill
                    key={o.value}
                    label={o.heart ? `${o.label} ♥` : o.label}
                    selected={chip === o.value}
                    onPress={() => setChip(o.value)}
                    colors={colors}
                  />
                ))}
              </View>
              {chip === "other" ? (
                <TextInput
                  value={chipOther}
                  onChangeText={setChipOther}
                  placeholder="Describe…"
                  placeholderTextColor={colors.mutedForeground}
                  style={[
                    styles.input,
                    { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.card },
                  ]}
                />
              ) : null}
            </>
          ) : null}

          {error ? (
            <Text style={[styles.helpError, { color: colors.destructive, marginTop: 12 }]}>{error}</Text>
          ) : null}
        </ScrollView>
      </View>
    </Modal>
  );
}

function RadioRow({
  selected,
  onPress,
  label,
  help,
  colors,
}: {
  selected: boolean;
  onPress: () => void;
  label: string;
  help: string;
  colors: ReturnType<typeof useColors>;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.radioRow,
        {
          borderColor: selected ? colors.primary : colors.border,
          backgroundColor: selected ? colors.primary + "15" : colors.card,
        },
      ]}
    >
      <Feather
        name={selected ? "check-circle" : "circle"}
        size={18}
        color={selected ? colors.primary : colors.mutedForeground}
      />
      <View style={{ flex: 1 }}>
        <Text style={[styles.radioLabel, { color: colors.foreground }]}>{label}</Text>
        <Text style={[styles.radioHelp, { color: colors.mutedForeground }]}>{help}</Text>
      </View>
    </Pressable>
  );
}

function ChipPill({
  label,
  selected,
  onPress,
  colors,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  colors: ReturnType<typeof useColors>;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.chip,
        {
          borderColor: selected ? colors.primary : colors.border,
          backgroundColor: selected ? colors.primary + "20" : colors.card,
        },
      ]}
    >
      <Text
        style={[
          styles.chipText,
          { color: selected ? colors.primary : colors.foreground },
        ]}
      >
        {label}
      </Text>
    </Pressable>
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
  title: { fontSize: 16, fontFamily: "Inter_700Bold" },
  save: { fontSize: 15, fontFamily: "Inter_700Bold" },
  scroll: { padding: 16, gap: 16 },
  subject: { fontSize: 13, fontFamily: "Inter_500Medium" },
  section: { fontSize: 14, fontFamily: "Inter_700Bold" },
  chipsRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
  },
  chipText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    fontFamily: "Inter_500Medium",
    marginTop: 8,
  },
  helpError: { fontSize: 13, fontFamily: "Inter_500Medium" },
  radioRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  radioLabel: { fontSize: 14, fontFamily: "Inter_700Bold" },
  radioHelp: { fontSize: 12, fontFamily: "Inter_500Medium", marginTop: 2 },
});
