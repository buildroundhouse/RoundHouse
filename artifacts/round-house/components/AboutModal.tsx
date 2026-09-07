import React from "react";
import {
  Image,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";

const logoImage = require("@/assets/images/logo-mark.png");

type Props = {
  visible: boolean;
  onClose: () => void;
};

export function AboutModal({ visible, onClose }: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={[s.root, { backgroundColor: colors.background }]}>
        <View
          style={[
            s.header,
            { borderBottomColor: colors.border, paddingTop: Platform.OS === "web" ? 24 : insets.top + 8 },
          ]}
        >
          <Pressable onPress={onClose} hitSlop={20} style={{ padding: 8 }}>
            <Feather name="x" size={22} color={colors.foreground} />
          </Pressable>
          <Text style={[s.title, { color: colors.foreground }]}>About Roundhouse</Text>
          <View style={{ width: 38 }} />
        </View>

        <ScrollView contentContainerStyle={{ padding: 24, paddingBottom: insets.bottom + 32, gap: 18 }}>
          <View style={{ alignItems: "center", gap: 8 }}>
            <Image source={logoImage} style={s.logoImg} resizeMode="contain" />
            <Text style={[s.tagline, { color: colors.foreground }]}>
              The permanent record of work — across properties, people, and time.
            </Text>
            <Text style={[s.tagline, { color: colors.mutedForeground }]}>
              Logs work. Tracks performance. Builds reputation.
            </Text>
          </View>

          <Section title="What it is" colors={colors}>
            Roundhouse is the record for physical properties. Every home, facility, and property becomes
            a shared space where the work and history stay as people pass through it.
          </Section>

          <Section title="Who it's for" colors={colors}>
            Property owners, trade professionals, and anyone responsible for work happening on a property.
          </Section>

          <Section title="Where it's going" colors={colors}>
            Expanding into shared visibility across properties, stronger reputation systems, and deeper
            coordination between people doing the work.
          </Section>

          <View style={{ gap: 6 }}>
            <Text style={[s.sectionTitle, { color: colors.mutedForeground }]}>CONTACT</Text>
            <Text style={[s.body, { color: colors.foreground }]}>
              Contact us for more information at{" "}
              <Text
                style={[s.emailLink, { color: colors.primary ?? colors.foreground }]}
                onPress={() => Linking.openURL("mailto:buildroundhouse@gmail.com")}
              >
                buildroundhouse@gmail.com
              </Text>
            </Text>
          </View>

          <Text style={[s.footer, { color: colors.mutedForeground }]}>Roundhouse 2026</Text>
        </ScrollView>
      </View>
    </Modal>
  );
}

function Section({
  title,
  children,
  colors,
}: {
  title: string;
  children: React.ReactNode;
  colors: ReturnType<typeof useColors>;
}) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={[s.sectionTitle, { color: colors.mutedForeground }]}>{title.toUpperCase()}</Text>
      <Text style={[s.body, { color: colors.foreground }]}>{children}</Text>
    </View>
  );
}

const s = StyleSheet.create({
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
  logoCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  logoImg: { width: 176, height: 176 },
  brand: { fontSize: 22, fontFamily: "Inter_700Bold" },
  tagline: { fontSize: 14, fontFamily: "Inter_400Regular", lineHeight: 20, textAlign: "center", maxWidth: 320 },
  sectionTitle: { fontSize: 11, fontFamily: "Inter_700Bold", letterSpacing: 0.8 },
  body: { fontSize: 14, fontFamily: "Inter_400Regular", lineHeight: 20 },
  emailLink: { fontFamily: "Inter_600SemiBold", textDecorationLine: "underline" },
  footer: {
    fontSize: 12,
    fontFamily: "Inter_500Medium",
    textAlign: "center",
    marginTop: 12,
  },
});
