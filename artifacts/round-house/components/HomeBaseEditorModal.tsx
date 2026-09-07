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
import { AddressAutocompleteInput } from "./AddressAutocompleteInput";

interface Props {
  visible: boolean;
  onClose: () => void;
}

/**
 * Standalone editor for a homeowner's "home base" intake fields:
 * property name, neighborhood, and street address. Reads the current home
 * mode's intake data, edits inline, and writes the merged intake data back
 * via the completeModeIntake mutation (PUT /users/me/modes/:modeId).
 */
export function HomeBaseEditorModal({ visible, onClose }: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { activeMode, refetchModes } = useProfile();
  const completeIntake = useCompleteModeIntake();

  const [placeName, setPlaceName] = useState("");
  const [neighborhood, setNeighborhood] = useState("");
  const [placeAddress, setPlaceAddress] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  // Initialize form state once per visible session for a given mode id, so
  // a background refetch of the active mode can't blow away in-progress edits.
  const initializedFor = useRef<number | null>(null);
  useEffect(() => {
    if (!visible) {
      initializedFor.current = null;
      return;
    }
    if (!activeMode) return;
    if (initializedFor.current === activeMode.id) return;
    const data = (activeMode.intakeData ?? {}) as Record<string, unknown>;
    setPlaceName(typeof data.placeName === "string" ? data.placeName : "");
    setNeighborhood(typeof data.neighborhood === "string" ? data.neighborhood : "");
    setPlaceAddress(typeof data.placeAddress === "string" ? data.placeAddress : "");
    setError("");
    setSaving(false);
    initializedFor.current = activeMode.id;
  }, [visible, activeMode]);

  const isHome = activeMode?.kind === "home";
  const canSave = placeName.trim().length > 0 && !saving;

  async function save() {
    if (!isHome || !activeMode || !canSave) return;
    if (placeName.trim().length === 0) {
      setError("Property name is required.");
      return;
    }
    setSaving(true);
    try {
      const existing = (activeMode.intakeData ?? {}) as Record<string, unknown>;
      const merged: Record<string, unknown> = {
        ...existing,
        placeName: placeName.trim(),
        neighborhood: neighborhood.trim(),
        placeAddress: placeAddress.trim(),
      };
      await completeIntake.mutateAsync({
        modeId: activeMode.id,
        data: { intakeData: merged },
      });
      await refetchModes();
      onClose();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not save home base.";
      setError(msg);
      Alert.alert("Could not save", msg);
    } finally {
      setSaving(false);
    }
  }

  if (!isHome) return null;

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
          <Text style={[styles.title, { color: colors.foreground }]}>Home base</Text>
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
            <Text style={[styles.label, { color: colors.foreground }]}>Property</Text>
            <TextInput
              style={[
                styles.input,
                { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground },
              ]}
              value={placeName}
              onChangeText={(t) => {
                setPlaceName(t);
                if (error) setError("");
              }}
              placeholder="The river house"
              placeholderTextColor={colors.mutedForeground}
              maxLength={60}
              autoCapitalize="words"
              autoCorrect={false}
            />

            <Text style={[styles.label, { color: colors.foreground, marginTop: 22 }]}>
              Neighborhood
            </Text>
            <TextInput
              style={[
                styles.input,
                { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground },
              ]}
              value={neighborhood}
              onChangeText={setNeighborhood}
              placeholder="South Austin, Mueller"
              placeholderTextColor={colors.mutedForeground}
              maxLength={80}
              autoCapitalize="words"
              autoCorrect={false}
            />

            <Text style={[styles.label, { color: colors.foreground, marginTop: 22 }]}>
              Street address
            </Text>
            <Text style={[styles.helper, { color: colors.mutedForeground }]}>
              Helps with mapping, deals nearby, and matching service-area pros. Never shown publicly.
            </Text>
            <AddressAutocompleteInput
              value={placeAddress}
              onChangeText={setPlaceAddress}
              onPickPlace={(p) => setPlaceAddress(p.formattedAddress)}
              placeholder="123 Main St, Austin, TX"
              returnKeyType="done"
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
    fontSize: 15,
    fontFamily: "Inter_400Regular",
    marginTop: 8,
  },
  error: { fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 12 },
});
