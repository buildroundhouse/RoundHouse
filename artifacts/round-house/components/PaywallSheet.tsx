import React from "react";
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { router, type Href } from "expo-router";
import { useColors } from "@/hooks/useColors";
import {
  subscribePaywall,
  type PaywallPayload,
} from "@/lib/paywallSheet";
import {
  PAYWALL_COPY,
  buildPaywallActions,
} from "@/lib/paywallSheetCopy";

export function PaywallSheet() {
  const colors = useColors();
  const [payload, setPayload] = React.useState<PaywallPayload | null>(null);

  React.useEffect(() => {
    return subscribePaywall((p) => setPayload(p));
  }, []);

  const { onEnable, onClose } = React.useMemo(
    () =>
      buildPaywallActions(payload, {
        setPayload,
        push: (href) => router.push(href as Href),
      }),
    [payload],
  );

  if (!payload) return null;

  const copy = PAYWALL_COPY[payload.capability];

  return (
    <Modal
      visible
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable
          onPress={() => {}}
          style={[
            styles.sheet,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
          accessibilityViewIsModal
        >
          <View style={styles.handle} />
          <View style={styles.headerRow}>
            <View
              style={[
                styles.iconWrap,
                {
                  backgroundColor: colors.primary + "20",
                  borderColor: colors.primary + "40",
                },
              ]}
            >
              <Feather name={copy.icon} size={20} color={colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.title, { color: colors.foreground }]}>
                {copy.title}
              </Text>
            </View>
            <TouchableOpacity
              onPress={onClose}
              hitSlop={10}
              accessibilityLabel="Close"
            >
              <Feather name="x" size={20} color={colors.mutedForeground} />
            </TouchableOpacity>
          </View>

          <Text style={[styles.body, { color: colors.mutedForeground }]}>
            {copy.body}
          </Text>

          <View style={{ gap: 8, marginTop: 6 }}>
            {copy.bullets.map((b) => (
              <View key={b} style={styles.bulletRow}>
                <Feather name="check" size={16} color={colors.primary} />
                <Text style={[styles.bulletText, { color: colors.foreground }]}>
                  {b}
                </Text>
              </View>
            ))}
          </View>

          <TouchableOpacity
            onPress={onEnable}
            accessibilityRole="button"
            accessibilityLabel="Enable expanded capabilities"
            style={[styles.primaryBtn, { backgroundColor: colors.primary }]}
          >
            <Text style={styles.primaryBtnText}>Enable</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={onClose}
            accessibilityRole="button"
            style={styles.secondaryBtn}
          >
            <Text style={[styles.secondaryBtnText, { color: colors.mutedForeground }]}>
              Not now
            </Text>
          </TouchableOpacity>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "flex-end",
  },
  sheet: {
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    paddingHorizontal: 18,
    paddingTop: 10,
    paddingBottom: 24,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: 12,
  },
  handle: {
    alignSelf: "center",
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: "rgba(127,127,127,0.4)",
    marginBottom: 4,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: StyleSheet.hairlineWidth,
  },
  title: { fontSize: 16, fontFamily: "Inter_700Bold" },
  body: { fontSize: 14, fontFamily: "Inter_400Regular", lineHeight: 20 },
  bulletRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  bulletText: { fontSize: 14, fontFamily: "Inter_500Medium" },
  primaryBtn: {
    marginTop: 8,
    paddingVertical: 14,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryBtnText: { fontSize: 15, fontFamily: "Inter_700Bold", color: "#fff" },
  secondaryBtn: {
    paddingVertical: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  secondaryBtnText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
});
