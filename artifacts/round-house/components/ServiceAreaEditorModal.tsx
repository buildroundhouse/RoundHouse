import React, { useEffect, useRef, useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
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
import { useCompleteModeIntake } from "@workspace/api-client-react";
import { useProfile } from "@/lib/profile";
import { ZipPicker } from "./ZipPicker";
import { geocodeZip } from "@/lib/zipGeocode";

const ZIP_RE = /^\d{5}$/;

interface Props {
  visible: boolean;
  onClose: () => void;
}

/**
 * Standalone editor for a trade pro's served ZIPs (primary + additional).
 * Reads the current trade_pro mode's intake data, edits ZIP fields with the
 * visual ZipPicker, and writes the merged intake data back via the
 * completeModeIntake mutation (PUT /users/me/modes/:modeId).
 */
export function ServiceAreaEditorModal({ visible, onClose }: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { activeMode, refetchModes } = useProfile();
  const completeIntake = useCompleteModeIntake();

  const [primaryZip, setPrimaryZip] = useState("");
  const [additionalZips, setAdditionalZips] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  // Track which mode id we've already seeded local state for during this open.
  // Without this guard, any unrelated change to the `activeMode` reference
  // (e.g. a background refetch from useProfile while the editor is open)
  // would re-run the effect and overwrite the user's in-progress edits —
  // including a just-removed ZIP — with whatever the server still has,
  // so Save then writes the un-edited list back. Initializing once per
  // (visible session, mode id) preserves edits across incidental refetches.
  const initializedForId = useRef<number | null>(null);

  useEffect(() => {
    if (!visible) {
      initializedForId.current = null;
      return;
    }
    if (!activeMode) return;
    if (initializedForId.current === activeMode.id) return;
    initializedForId.current = activeMode.id;

    const data = (activeMode.intakeData ?? {}) as Record<string, unknown>;
    const p = typeof data.primaryZip === "string" ? data.primaryZip : "";
    const raw = data.additionalZips;
    const arr = Array.isArray(raw)
      ? (raw as unknown[]).filter((z): z is string => typeof z === "string" && ZIP_RE.test(z))
      : typeof raw === "string"
        ? raw
            .split(/[\s,;]+/)
            .map((s) => s.trim())
            .filter((s) => ZIP_RE.test(s))
        : [];
    setPrimaryZip(p);
    setAdditionalZips(arr);
    setError("");
    setSaving(false);
  }, [visible, activeMode]);

  const isTradePro = activeMode?.kind === "trade_pro";
  const canSave = ZIP_RE.test(primaryZip) && !saving;

  async function save() {
    if (!isTradePro || !activeMode || !canSave) return;
    if (!ZIP_RE.test(primaryZip)) {
      setError("Primary ZIP must be a 5-digit ZIP code.");
      return;
    }
    setSaving(true);
    try {
      const existing = (activeMode.intakeData ?? {}) as Record<string, unknown>;
      const street = typeof existing.streetAddress === "string" ? existing.streetAddress.trim() : "";
      const merged: Record<string, unknown> = {
        ...existing,
        primaryZip,
        additionalZips: additionalZips.filter((z) => ZIP_RE.test(z) && z !== primaryZip),
      };
      const coords = await geocodeZip(primaryZip, street);
      if (coords) {
        merged.lat = coords.lat;
        merged.lng = coords.lng;
      } else {
        delete merged.lat;
        delete merged.lng;
      }
      await completeIntake.mutateAsync({
        modeId: activeMode.id,
        data: { intakeData: merged },
      });
      await refetchModes();
      onClose();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not save service area.";
      setError(msg);
      Alert.alert("Could not save", msg);
    } finally {
      setSaving(false);
    }
  }

  if (!isTradePro) return null;

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
          <Text style={[styles.title, { color: colors.foreground }]}>Service area</Text>
          <Pressable onPress={save} disabled={!canSave} hitSlop={20} style={{ padding: 8 }}>
            <Text
              style={[
                styles.saveText,
                { color: canSave ? colors.primary : colors.mutedForeground },
              ]}
            >
              {saving ? "…" : "Save"}
            </Text>
          </Pressable>
        </View>

        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
          <ScrollView
            contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 32 }]}
            keyboardShouldPersistTaps="handled"
          >
            <Text style={[styles.label, { color: colors.foreground }]}>Primary ZIP</Text>
            <Text style={[styles.helper, { color: colors.mutedForeground }]}>
              Your home base — the 5-digit ZIP we'll match you on.
            </Text>
            <TextInput
              style={[
                styles.input,
                {
                  backgroundColor: colors.card,
                  borderColor: colors.border,
                  color: colors.foreground,
                },
              ]}
              value={primaryZip}
              onChangeText={(t) => {
                setPrimaryZip(t.replace(/[^\d]/g, "").slice(0, 5));
                if (error) setError("");
              }}
              keyboardType="number-pad"
              maxLength={5}
              placeholder="78701"
              placeholderTextColor={colors.mutedForeground}
            />

            <Text style={[styles.label, { color: colors.foreground, marginTop: 22 }]}>
              Other ZIPs you serve
            </Text>
            <Text style={[styles.helper, { color: colors.mutedForeground }]}>
              Tap nearby ZIPs to add them, or enter your own.
            </Text>

            <ZipPicker
              primaryZip={primaryZip}
              value={additionalZips}
              onChange={setAdditionalZips}
            />

            {error ? <Text style={[styles.error, { color: "#E55" }]}>{error}</Text> : null}
          </ScrollView>
        </KeyboardAvoidingView>
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
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  title: { fontSize: 16, fontFamily: "Inter_700Bold" },
  saveText: { fontSize: 15, fontFamily: "Inter_700Bold" },
  scroll: { padding: 20, gap: 8 },
  label: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  helper: { fontSize: 12, fontFamily: "Inter_400Regular", marginBottom: 8 },
  input: {
    height: 50,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 14,
    fontSize: 16,
    fontFamily: "Inter_500Medium",
    letterSpacing: 1,
    marginBottom: 8,
  },
  error: { fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 12 },
});
