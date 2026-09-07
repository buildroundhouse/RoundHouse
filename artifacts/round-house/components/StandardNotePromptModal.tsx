import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useColors } from "@/hooks/useColors";

interface Props {
  visible: boolean;
  standardTitle?: string;
  hasPhoto?: boolean;
  submitting?: boolean;
  suggestions?: string[];
  onClose: () => void;
  onSubmit: (note: string | null) => Promise<void> | void;
}

export function StandardNotePromptModal({
  visible,
  standardTitle,
  hasPhoto,
  submitting,
  suggestions,
  onClose,
  onSubmit,
}: Props) {
  const colors = useColors();
  const [note, setNote] = useState("");

  useEffect(() => {
    if (visible) setNote("");
  }, [visible]);

  const submit = async () => {
    const trimmed = note.trim();
    await onSubmit(trimmed.length ? trimmed : null);
  };

  const chips = (suggestions ?? []).filter((s) => s && s.trim().length).slice(0, 4);

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.backdrop}
      >
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.title, { color: colors.foreground }]}>Add a note?</Text>
          <Text style={[styles.sub, { color: colors.mutedForeground }]}>
            {standardTitle
              ? `Optional note for "${standardTitle}".`
              : "Optional note for this evidence."}
            {hasPhoto ? " Your photo will be attached." : ""}
          </Text>
          {chips.length > 0 ? (
            <View style={styles.suggestionsWrap}>
              <Text style={[styles.suggestLabel, { color: colors.mutedForeground }]}>
                Quick phrases
              </Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.chipsRow}
              >
                {chips.map((phrase) => {
                  const active = note.trim() === phrase.trim();
                  return (
                    <TouchableOpacity
                      key={phrase}
                      onPress={() => setNote(phrase)}
                      disabled={submitting}
                      accessibilityRole="button"
                      accessibilityLabel={`Use phrase ${phrase}`}
                      style={[
                        styles.chip,
                        {
                          borderColor: active ? colors.primary : colors.border,
                          backgroundColor: active
                            ? colors.primary + "15"
                            : colors.background,
                        },
                      ]}
                    >
                      <Text
                        numberOfLines={1}
                        style={[
                          styles.chipText,
                          { color: active ? colors.primary : colors.foreground },
                        ]}
                      >
                        {phrase}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            </View>
          ) : null}
          <TextInput
            placeholder="e.g. Replaced filter, ordered new one"
            placeholderTextColor={colors.mutedForeground}
            value={note}
            onChangeText={setNote}
            multiline
            autoFocus
            editable={!submitting}
            style={[
              styles.input,
              {
                color: colors.foreground,
                backgroundColor: colors.background,
                borderColor: colors.border,
              },
            ]}
          />
          <View style={styles.actions}>
            <TouchableOpacity
              onPress={onClose}
              disabled={submitting}
              style={styles.cancelBtn}
            >
              <Text style={[styles.cancelText, { color: colors.mutedForeground }]}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={submit}
              disabled={submitting}
              style={[styles.submitBtn, { backgroundColor: colors.primary }]}
            >
              {submitting ? (
                <ActivityIndicator color={colors.primaryForeground} />
              ) : (
                <Text style={[styles.submitText, { color: colors.primaryForeground }]}>
                  {note.trim().length ? "Save with note" : "Save without note"}
                </Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  card: {
    width: "100%",
    maxWidth: 420,
    borderRadius: 16,
    borderWidth: 1,
    padding: 20,
    gap: 12,
  },
  title: { fontSize: 18, fontFamily: "Inter_700Bold" },
  sub: { fontSize: 13, fontFamily: "Inter_400Regular" },
  suggestionsWrap: { gap: 6 },
  suggestLabel: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  chipsRow: { gap: 8, paddingRight: 4 },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: 1,
    maxWidth: 220,
  },
  chipText: { fontSize: 13, fontFamily: "Inter_500Medium" },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    minHeight: 80,
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    textAlignVertical: "top",
  },
  actions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 8,
    marginTop: 4,
  },
  cancelBtn: { paddingHorizontal: 14, paddingVertical: 10 },
  cancelText: { fontSize: 14, fontFamily: "Inter_500Medium" },
  submitBtn: {
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 20,
    minWidth: 140,
    alignItems: "center",
  },
  submitText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
});
