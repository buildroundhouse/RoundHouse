import React from "react";
import { Modal, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { AttachmentList, PhotoPreview, type AttachmentItem } from "@/components/AttachmentList";

type Spec = { id: number; key: string; value: string; category: string; photoPath?: string | null };
type Note = { id: number; title: string; body: string; attachments?: AttachmentItem[]; author?: { name?: string } | null };
type Log = { id: number; note: string; createdAt: string | Date; author?: { name?: string } | null };

interface Props {
  visible: boolean;
  onClose: () => void;
  propertyName: string;
  joinedAt: string | Date;
  specs: Spec[];
  pinnedNotes: Note[];
  recentLogs: Log[];
}

function formatDate(d: string | Date): string {
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function PropertyOnboardingCard({
  visible,
  onClose,
  propertyName,
  joinedAt,
  specs,
  pinnedNotes,
  recentLogs,
}: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const topPad = Platform.OS === "web" ? 24 : insets.top + 8;

  const grouped = specs.reduce<Record<string, Spec[]>>((acc, s) => {
    const cat = s.category || "general";
    (acc[cat] ||= []).push(s);
    return acc;
  }, {});

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={[styles.header, { paddingTop: topPad, borderBottomColor: colors.border }]}>
          <View style={styles.headerText}>
            <Text style={[styles.eyebrow, { color: colors.primary }]}>WELCOME TO THIS PROPERTY</Text>
            <Text style={[styles.title, { color: colors.foreground }]} numberOfLines={2}>
              {propertyName}
            </Text>
            <Text style={[styles.sub, { color: colors.mutedForeground }]}>
              Added {formatDate(joinedAt)} · here&apos;s what you should know
            </Text>
          </View>
          <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
            <Feather name="x" size={22} color={colors.foreground} />
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]}>
          <Section title="Property specs" icon="clipboard" colors={colors}>
            {specs.length === 0 ? (
              <Text style={[styles.empty, { color: colors.mutedForeground }]}>
                No specs recorded yet.
              </Text>
            ) : (
              Object.entries(grouped).map(([cat, items]) => (
                <View key={cat} style={styles.specGroup}>
                  <Text style={[styles.specGroupTitle, { color: colors.mutedForeground }]}>
                    {cat.toUpperCase()}
                  </Text>
                  {items.map((s) => (
                    <View key={s.id} style={[styles.specRowCol, { borderBottomColor: colors.border }]}>
                      <View style={styles.specRowTop}>
                        <Text style={[styles.specKey, { color: colors.mutedForeground }]}>{s.key}</Text>
                        <Text style={[styles.specValue, { color: colors.foreground }]}>{s.value || "—"}</Text>
                      </View>
                      {s.photoPath ? <PhotoPreview path={s.photoPath} size={72} /> : null}
                    </View>
                  ))}
                </View>
              ))
            )}
          </Section>

          <Section title="Pinned notes" icon="bookmark" colors={colors}>
            {pinnedNotes.length === 0 ? (
              <Text style={[styles.empty, { color: colors.mutedForeground }]}>
                No pinned notes.
              </Text>
            ) : (
              pinnedNotes.map((n) => (
                <View key={n.id} style={[styles.noteCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  {n.title ? (
                    <Text style={[styles.noteTitle, { color: colors.foreground }]}>{n.title}</Text>
                  ) : null}
                  <Text style={[styles.noteBody, { color: colors.foreground }]}>{n.body}</Text>
                  {n.attachments && n.attachments.length > 0 ? (
                    <AttachmentList attachments={n.attachments} size="sm" />
                  ) : null}
                  <Text style={[styles.noteAuthor, { color: colors.mutedForeground }]}>
                    — {n.author?.name || "Member"}
                  </Text>
                </View>
              ))
            )}
          </Section>

          <Section title="Recent work" icon="activity" colors={colors}>
            {recentLogs.length === 0 ? (
              <Text style={[styles.empty, { color: colors.mutedForeground }]}>
                No work logged yet.
              </Text>
            ) : (
              recentLogs.slice(0, 6).map((l) => (
                <View key={l.id} style={[styles.logRow, { borderBottomColor: colors.border }]}>
                  <Text style={[styles.logNote, { color: colors.foreground }]} numberOfLines={2}>
                    {l.note}
                  </Text>
                  <Text style={[styles.logMeta, { color: colors.mutedForeground }]}>
                    {l.author?.name || "Member"} · {formatDate(l.createdAt)}
                  </Text>
                </View>
              ))
            )}
          </Section>

          <TouchableOpacity
            style={[styles.gotItBtn, { backgroundColor: colors.primary }]}
            onPress={onClose}
          >
            <Text style={[styles.gotItText, { color: colors.primaryForeground }]}>Got it</Text>
          </TouchableOpacity>
        </ScrollView>
      </View>
    </Modal>
  );
}

function Section({
  title,
  icon,
  children,
  colors,
}: {
  title: string;
  icon: React.ComponentProps<typeof Feather>["name"];
  children: React.ReactNode;
  colors: ReturnType<typeof useColors>;
}) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Feather name={icon} size={14} color={colors.primary} />
        <Text style={[styles.sectionTitle, { color: colors.foreground }]}>{title}</Text>
      </View>
      <View>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingHorizontal: 20,
    paddingBottom: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 12,
  },
  headerText: { flex: 1, gap: 4 },
  eyebrow: { fontSize: 11, fontFamily: "Inter_600SemiBold", letterSpacing: 0.8 },
  title: { fontSize: 22, fontFamily: "Inter_700Bold" },
  sub: { fontSize: 13, fontFamily: "Inter_400Regular" },
  closeBtn: { padding: 4 },
  content: { padding: 20, gap: 24 },
  section: { gap: 10 },
  sectionHeader: { flexDirection: "row", alignItems: "center", gap: 6 },
  sectionTitle: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  empty: { fontSize: 13, fontFamily: "Inter_400Regular", paddingVertical: 8 },
  specGroup: { marginTop: 4 },
  specGroupTitle: {
    fontSize: 10,
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 0.8,
    marginTop: 8,
    marginBottom: 4,
  },
  specRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 12,
  },
  specRowCol: {
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 8,
  },
  specRowTop: { flexDirection: "row", justifyContent: "space-between", gap: 12 },
  specKey: { fontSize: 13, fontFamily: "Inter_500Medium", flex: 1 },
  specValue: { fontSize: 13, fontFamily: "Inter_400Regular", flex: 1.5, textAlign: "right" },
  noteCard: {
    borderRadius: 10,
    borderWidth: 1,
    padding: 12,
    marginBottom: 8,
    gap: 4,
  },
  noteTitle: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  noteBody: { fontSize: 14, fontFamily: "Inter_400Regular", lineHeight: 20 },
  noteAuthor: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 2 },
  logRow: { paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, gap: 4 },
  logNote: { fontSize: 14, fontFamily: "Inter_400Regular" },
  logMeta: { fontSize: 11, fontFamily: "Inter_400Regular" },
  gotItBtn: {
    paddingVertical: 14,
    borderRadius: 24,
    alignItems: "center",
    marginTop: 8,
  },
  gotItText: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
});
