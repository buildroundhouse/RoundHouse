import React, { useEffect, useState } from "react";
import {
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

interface Values {
  title: string;
  description: string;
  cadenceDays: number;
  evidenceType: string;
  keyword: string;
  quickPhrases: string[];
}

interface Props {
  visible: boolean;
  onClose: () => void;
  onSubmit: (values: Values) => void | Promise<void>;
  initial?: Partial<Values>;
  title: string;
  pastNotes?: string[];
}

const CADENCE_OPTIONS = [
  { label: "Daily", days: 1 },
  { label: "Weekly", days: 7 },
  { label: "Bi-weekly", days: 14 },
  { label: "Monthly", days: 30 },
  { label: "Quarterly", days: 90 },
];

const EVIDENCE_OPTIONS = [
  { label: "Log entry", value: "log" },
  { label: "Photo", value: "photo" },
  { label: "Rating", value: "rating" },
];

const MAX_QUICK_PHRASES = 12;
const MAX_QUICK_PHRASE_LENGTH = 80;

export function StandardEditorModal({ visible, onClose, onSubmit, initial, title, pastNotes }: Props) {
  const colors = useColors();
  const [titleVal, setTitleVal] = useState("");
  const [description, setDescription] = useState("");
  const [cadenceDays, setCadenceDays] = useState(7);
  const [evidenceType, setEvidenceType] = useState("log");
  const [keyword, setKeyword] = useState("");
  const [quickPhrases, setQuickPhrases] = useState<string[]>([]);
  const [phraseDraft, setPhraseDraft] = useState("");

  useEffect(() => {
    if (visible) {
      setTitleVal(initial?.title ?? "");
      setDescription(initial?.description ?? "");
      setCadenceDays(initial?.cadenceDays ?? 7);
      setEvidenceType(initial?.evidenceType ?? "log");
      setKeyword(initial?.keyword ?? "");
      setQuickPhrases(initial?.quickPhrases ?? []);
      setPhraseDraft("");
    }
  }, [visible, initial]);

  const canSave = titleVal.trim().length > 0 && cadenceDays > 0;

  const addPhrase = () => {
    const trimmed = phraseDraft.trim();
    if (!trimmed) return;
    if (trimmed.length > MAX_QUICK_PHRASE_LENGTH) return;
    if (quickPhrases.length >= MAX_QUICK_PHRASES) return;
    if (quickPhrases.some((p) => p.toLowerCase() === trimmed.toLowerCase())) {
      setPhraseDraft("");
      return;
    }
    setQuickPhrases([...quickPhrases, trimmed]);
    setPhraseDraft("");
  };

  const removePhrase = (idx: number) => {
    setQuickPhrases(quickPhrases.filter((_, i) => i !== idx));
  };

  const movePhrase = (idx: number, dir: -1 | 1) => {
    const target = idx + dir;
    if (target < 0 || target >= quickPhrases.length) return;
    const next = [...quickPhrases];
    const [item] = next.splice(idx, 1);
    next.splice(target, 0, item);
    setQuickPhrases(next);
  };

  const handleSave = async () => {
    if (!canSave) return;
    await onSubmit({
      title: titleVal.trim(),
      description: description.trim(),
      cadenceDays,
      evidenceType,
      keyword: keyword.trim(),
      quickPhrases,
    });
    onClose();
  };

  const phraseLimitReached = quickPhrases.length >= MAX_QUICK_PHRASES;

  const suggestablePastNotes = (pastNotes ?? [])
    .map((p) => p.trim())
    .filter((p) => p.length > 0 && p.length <= MAX_QUICK_PHRASE_LENGTH);
  const canSuggest = quickPhrases.length === 0 && suggestablePastNotes.length > 0;
  const seedFromPastNotes = () => {
    const seen = new Set<string>();
    const seeded: string[] = [];
    for (const phrase of suggestablePastNotes) {
      const key = phrase.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      seeded.push(phrase);
      if (seeded.length >= MAX_QUICK_PHRASES) break;
    }
    if (seeded.length > 0) setQuickPhrases(seeded);
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={[styles.container, { backgroundColor: colors.background }]}
      >
        <View style={[styles.header, { borderBottomColor: colors.border, paddingTop: Platform.OS === "web" ? 24 : 0 }]}>
          <TouchableOpacity onPress={onClose}>
            <Text style={[styles.cancelText, { color: colors.mutedForeground }]}>Cancel</Text>
          </TouchableOpacity>
          <Text style={[styles.titleText, { color: colors.foreground }]}>{title}</Text>
          <TouchableOpacity
            onPress={handleSave}
            style={[styles.saveBtn, { backgroundColor: canSave ? colors.primary : colors.muted }]}
          >
            <Text
              style={[
                styles.saveText,
                { color: canSave ? colors.primaryForeground : colors.mutedForeground },
              ]}
            >
              Save
            </Text>
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Text style={[styles.label, { color: colors.mutedForeground }]}>STANDARD</Text>
          <TextInput
            value={titleVal}
            onChangeText={setTitleVal}
            placeholder="e.g. Pool pH checked weekly"
            placeholderTextColor={colors.mutedForeground}
            style={[
              styles.input,
              { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.card },
            ]}
          />

          <Text style={[styles.label, { color: colors.mutedForeground }]}>DESCRIPTION</Text>
          <TextInput
            value={description}
            onChangeText={setDescription}
            placeholder="Optional details"
            placeholderTextColor={colors.mutedForeground}
            multiline
            numberOfLines={3}
            style={[
              styles.input,
              styles.multiline,
              { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.card },
            ]}
          />

          <Text style={[styles.label, { color: colors.mutedForeground }]}>CADENCE</Text>
          <View style={styles.optRow}>
            {CADENCE_OPTIONS.map((opt) => (
              <TouchableOpacity
                key={opt.days}
                onPress={() => setCadenceDays(opt.days)}
                style={[
                  styles.chip,
                  {
                    borderColor: cadenceDays === opt.days ? colors.primary : colors.border,
                    backgroundColor: cadenceDays === opt.days ? colors.primary + "15" : "transparent",
                  },
                ]}
              >
                <Text
                  style={[
                    styles.chipText,
                    { color: cadenceDays === opt.days ? colors.primary : colors.mutedForeground },
                  ]}
                >
                  {opt.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={[styles.label, { color: colors.mutedForeground }]}>EVIDENCE</Text>
          <View style={styles.optRow}>
            {EVIDENCE_OPTIONS.map((opt) => (
              <TouchableOpacity
                key={opt.value}
                onPress={() => setEvidenceType(opt.value)}
                style={[
                  styles.chip,
                  {
                    borderColor: evidenceType === opt.value ? colors.primary : colors.border,
                    backgroundColor: evidenceType === opt.value ? colors.primary + "15" : "transparent",
                  },
                ]}
              >
                <Text
                  style={[
                    styles.chipText,
                    { color: evidenceType === opt.value ? colors.primary : colors.mutedForeground },
                  ]}
                >
                  {opt.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={[styles.label, { color: colors.mutedForeground }]}>KEYWORD (optional)</Text>
          <TextInput
            value={keyword}
            onChangeText={setKeyword}
            placeholder="e.g. pool, lawn, edge"
            placeholderTextColor={colors.mutedForeground}
            style={[
              styles.input,
              { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.card },
            ]}
          />
          <Text style={[styles.hint, { color: colors.mutedForeground }]}>
            If set, only logs whose note contains this word count toward this standard.
          </Text>

          <Text style={[styles.label, { color: colors.mutedForeground }]}>QUICK PHRASES (optional)</Text>
          <Text style={[styles.hint, { color: colors.mutedForeground, marginTop: 0 }]}>
            Shown as taps when marking this standard met. Replaces the built-in suggestions.
          </Text>

          {canSuggest ? (
            <TouchableOpacity
              onPress={seedFromPastNotes}
              accessibilityRole="button"
              accessibilityLabel="Suggest quick phrases from past notes"
              style={[
                styles.suggestBtn,
                { borderColor: colors.primary, backgroundColor: colors.primary + "10" },
              ]}
            >
              <Text style={[styles.suggestText, { color: colors.primary }]}>
                Suggest from past notes
              </Text>
            </TouchableOpacity>
          ) : null}

          {quickPhrases.length > 0 ? (
            <View style={styles.phraseList}>
              {quickPhrases.map((phrase, idx) => (
                <View
                  key={`${phrase}-${idx}`}
                  style={[
                    styles.phraseRow,
                    { borderColor: colors.border, backgroundColor: colors.card },
                  ]}
                >
                  <Text
                    numberOfLines={2}
                    style={[styles.phraseText, { color: colors.foreground }]}
                  >
                    {phrase}
                  </Text>
                  <View style={styles.phraseActions}>
                    <TouchableOpacity
                      onPress={() => movePhrase(idx, -1)}
                      disabled={idx === 0}
                      accessibilityRole="button"
                      accessibilityLabel="Move phrase up"
                      style={[
                        styles.phraseAction,
                        {
                          borderColor: colors.border,
                          opacity: idx === 0 ? 0.4 : 1,
                        },
                      ]}
                    >
                      <Text style={[styles.phraseActionText, { color: colors.foreground }]}>↑</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => movePhrase(idx, 1)}
                      disabled={idx === quickPhrases.length - 1}
                      accessibilityRole="button"
                      accessibilityLabel="Move phrase down"
                      style={[
                        styles.phraseAction,
                        {
                          borderColor: colors.border,
                          opacity: idx === quickPhrases.length - 1 ? 0.4 : 1,
                        },
                      ]}
                    >
                      <Text style={[styles.phraseActionText, { color: colors.foreground }]}>↓</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => removePhrase(idx)}
                      accessibilityRole="button"
                      accessibilityLabel={`Remove phrase ${phrase}`}
                      style={[styles.phraseAction, { borderColor: colors.border }]}
                    >
                      <Text style={[styles.phraseActionText, { color: colors.destructive }]}>×</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ))}
            </View>
          ) : null}

          <View style={styles.phraseAddRow}>
            <TextInput
              value={phraseDraft}
              onChangeText={setPhraseDraft}
              placeholder="Add a phrase"
              placeholderTextColor={colors.mutedForeground}
              maxLength={MAX_QUICK_PHRASE_LENGTH}
              editable={!phraseLimitReached}
              onSubmitEditing={addPhrase}
              returnKeyType="done"
              style={[
                styles.input,
                styles.phraseInput,
                {
                  color: colors.foreground,
                  borderColor: colors.border,
                  backgroundColor: colors.card,
                  opacity: phraseLimitReached ? 0.5 : 1,
                },
              ]}
            />
            <TouchableOpacity
              onPress={addPhrase}
              disabled={!phraseDraft.trim() || phraseLimitReached}
              accessibilityRole="button"
              accessibilityLabel="Add quick phrase"
              style={[
                styles.phraseAddBtn,
                {
                  backgroundColor:
                    phraseDraft.trim() && !phraseLimitReached ? colors.primary : colors.muted,
                },
              ]}
            >
              <Text
                style={[
                  styles.phraseAddText,
                  {
                    color:
                      phraseDraft.trim() && !phraseLimitReached
                        ? colors.primaryForeground
                        : colors.mutedForeground,
                  },
                ]}
              >
                Add
              </Text>
            </TouchableOpacity>
          </View>
          {phraseLimitReached ? (
            <Text style={[styles.hint, { color: colors.mutedForeground }]}>
              You can save up to {MAX_QUICK_PHRASES} phrases.
            </Text>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  cancelText: { fontSize: 14, fontFamily: "Inter_500Medium" },
  titleText: { fontSize: 16, fontFamily: "Inter_700Bold" },
  saveBtn: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 16 },
  saveText: { fontSize: 13, fontFamily: "Inter_700Bold" },
  content: { padding: 16, gap: 8, paddingBottom: 60 },
  label: { fontSize: 11, fontFamily: "Inter_700Bold", letterSpacing: 0.8, marginTop: 14, marginBottom: 6 },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    fontSize: 15,
    fontFamily: "Inter_400Regular",
  },
  multiline: { minHeight: 70, textAlignVertical: "top" },
  optRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 16, borderWidth: 1 },
  chipText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  hint: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 6, lineHeight: 16 },
  phraseList: { gap: 8, marginTop: 8 },
  phraseRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
  },
  phraseText: { flex: 1, fontSize: 14, fontFamily: "Inter_500Medium" },
  phraseActions: { flexDirection: "row", gap: 6 },
  phraseAction: {
    width: 32,
    height: 32,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  phraseActionText: { fontSize: 16, fontFamily: "Inter_700Bold" },
  phraseAddRow: { flexDirection: "row", gap: 8, marginTop: 10, alignItems: "center" },
  phraseInput: { flex: 1 },
  phraseAddBtn: { paddingHorizontal: 16, paddingVertical: 12, borderRadius: 10 },
  phraseAddText: { fontSize: 14, fontFamily: "Inter_700Bold" },
  suggestBtn: {
    marginTop: 10,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    alignSelf: "flex-start",
  },
  suggestText: { fontSize: 13, fontFamily: "Inter_700Bold" },
});
