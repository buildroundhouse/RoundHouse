import React, { useState, useEffect } from "react";
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useColors } from "@/hooks/useColors";
import { RatingStars } from "./RatingStars";

interface Props {
  visible: boolean;
  assigneeName?: string;
  onClose: () => void;
  onSubmit: (stars: number, comment?: string) => Promise<void> | void;
}

export function RatingPromptModal({ visible, assigneeName, onClose, onSubmit }: Props) {
  const colors = useColors();
  const [stars, setStars] = useState(0);
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (visible) {
      setStars(0);
      setComment("");
    }
  }, [visible]);

  const submit = async () => {
    if (stars < 1) return;
    setSubmitting(true);
    try {
      await onSubmit(stars, comment.trim() || undefined);
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      visible={visible}
      animationType="fade"
      transparent
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.backdrop}
      >
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.title, { color: colors.foreground }]}>Rate the job</Text>
          {assigneeName ? (
            <Text style={[styles.sub, { color: colors.mutedForeground }]}>
              How was {assigneeName}&apos;s work?
            </Text>
          ) : null}
          <View style={styles.starsWrap}>
            <RatingStars value={stars} size={32} onChange={setStars} />
          </View>
          <TextInput
            placeholder="Add a note (optional)"
            placeholderTextColor={colors.mutedForeground}
            value={comment}
            onChangeText={setComment}
            multiline
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
            <TouchableOpacity onPress={onClose} style={styles.cancelBtn}>
              <Text style={[styles.cancelText, { color: colors.mutedForeground }]}>Skip</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={submit}
              disabled={stars < 1 || submitting}
              style={[
                styles.submitBtn,
                { backgroundColor: stars > 0 ? colors.primary : colors.muted },
              ]}
            >
              <Text
                style={[
                  styles.submitText,
                  { color: stars > 0 ? colors.primaryForeground : colors.mutedForeground },
                ]}
              >
                Submit
              </Text>
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
  starsWrap: { alignItems: "center", paddingVertical: 12 },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    minHeight: 64,
    fontSize: 14,
    fontFamily: "Inter_400Regular",
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
  },
  submitText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
});
