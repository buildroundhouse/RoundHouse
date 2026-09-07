import React from "react";
import { Platform, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";

export function UndoSnackbar({
  visible,
  message,
  secondsLeft,
  onUndo,
}: {
  visible: boolean;
  message: string;
  secondsLeft?: number;
  onUndo: () => void;
}) {
  const colors = useColors();
  if (!visible) return null;
  return (
    <View
      pointerEvents="box-none"
      style={[
        styles.wrap,
        Platform.OS === "web" ? styles.wrapWeb : styles.wrapNative,
      ]}
    >
      <View
        style={[
          styles.bar,
          { backgroundColor: colors.foreground, borderColor: colors.border },
        ]}
        accessibilityLiveRegion="polite"
      >
        <Feather name="trash-2" size={16} color={colors.background} />
        <Text style={[styles.text, { color: colors.background }]} numberOfLines={1}>
          {message}
          {secondsLeft != null && secondsLeft > 0 ? ` · ${secondsLeft}s` : ""}
        </Text>
        <TouchableOpacity
          onPress={onUndo}
          hitSlop={8}
          style={styles.btn}
          accessibilityLabel="Undo delete"
        >
          <Text style={[styles.btnText, { color: colors.primary }]}>Undo</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: "absolute",
    left: 12,
    right: 12,
    alignItems: "stretch",
    zIndex: 100,
  },
  wrapNative: { bottom: 24 },
  wrapWeb: { bottom: 16 },
  bar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    shadowColor: "#000",
    shadowOpacity: 0.18,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 10,
    elevation: 4,
  },
  text: { flex: 1, fontSize: 13, fontFamily: "Inter_600SemiBold" },
  btn: { paddingHorizontal: 8, paddingVertical: 4 },
  btnText: { fontSize: 13, fontFamily: "Inter_700Bold" },
});
