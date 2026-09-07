import React, { useState } from "react";
import { Linking, Pressable, StyleSheet, Text, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";

type Props = {
  smsUri: string;
  smsBody: string;
  recipientName: string;
  onDone: () => void;
};

export function InviteSendOptions({
  smsUri,
  smsBody,
  recipientName,
  onDone,
}: Props) {
  const colors = useColors();
  const [copied, setCopied] = useState(false);
  const [openHint, setOpenHint] = useState<string | null>(null);

  const handleCopy = async () => {
    setOpenHint(null);
    try {
      await Clipboard.setStringAsync(smsBody);
      setCopied(true);
      setTimeout(() => setCopied(false), 2200);
    } catch {
      setOpenHint(
        "Couldn't copy automatically. Tap and hold the message above to select it.",
      );
    }
  };

  const handleOpen = async () => {
    setOpenHint(null);
    try {
      await Linking.openURL(smsUri);
    } catch {
      setOpenHint(
        "Your device wouldn't open Messages. Use Copy and paste the message into a new text.",
      );
    }
  };

  return (
    <View style={styles.wrap}>
      <Text style={[styles.title, { color: colors.foreground }]}>
        Invite for {recipientName} is ready
      </Text>
      <Text style={[styles.sub, { color: colors.mutedForeground }]}>
        Tap "Open Messages" to send the draft, or copy the text and paste it
        into a new message.
      </Text>

      <View
        style={[
          styles.preview,
          { borderColor: colors.border, backgroundColor: colors.card },
        ]}
      >
        <Text
          selectable
          style={[styles.previewText, { color: colors.foreground }]}
        >
          {smsBody}
        </Text>
      </View>

      <View style={styles.btnRow}>
        <Pressable
          accessibilityRole="button"
          onPress={handleOpen}
          style={[styles.primaryBtn, { backgroundColor: colors.primary }]}
        >
          <Feather name="send" size={16} color={colors.primaryForeground} />
          <Text
            style={[styles.primaryBtnText, { color: colors.primaryForeground }]}
          >
            Open Messages
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={handleCopy}
          style={[
            styles.secondaryBtn,
            {
              borderColor: copied ? colors.primary : colors.border,
              backgroundColor: copied ? `${colors.primary}11` : "transparent",
            },
          ]}
        >
          <Feather
            name={copied ? "check" : "copy"}
            size={16}
            color={copied ? colors.primary : colors.foreground}
          />
          <Text
            style={[
              styles.secondaryBtnText,
              { color: copied ? colors.primary : colors.foreground },
            ]}
          >
            {copied ? "Copied" : "Copy text"}
          </Text>
        </Pressable>
      </View>

      {openHint ? (
        <Text style={[styles.hint, { color: colors.mutedForeground }]}>
          {openHint}
        </Text>
      ) : null}

      <Pressable
        accessibilityRole="button"
        onPress={onDone}
        style={styles.doneBtn}
      >
        <Text style={[styles.doneText, { color: colors.mutedForeground }]}>
          Done
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 12 },
  title: { fontSize: 16, fontFamily: "Inter_700Bold" },
  sub: { fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 18 },
  preview: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
  },
  previewText: { fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 19 },
  btnRow: { flexDirection: "row", gap: 8 },
  primaryBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 12,
    borderRadius: 12,
  },
  primaryBtnText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  secondaryBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  secondaryBtnText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  hint: { fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 16 },
  doneBtn: { alignItems: "center", paddingVertical: 8 },
  doneText: { fontSize: 13, fontFamily: "Inter_500Medium" },
});
