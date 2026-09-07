/**
 * ============================================================================
 *  PARADIGM NOTICE — LEGACY SHEET, DO NOT EXTEND OR REUSE FOR NEW SURFACES.
 * ============================================================================
 *
 *  This sheet implements the OLD avatar-to-avatar "Why are you connecting?"
 *  Client / Core / Collaborator picker. Round House has formally moved to
 *  an entity-only paradigm:
 *
 *    People (avatars) are identity ONLY.
 *    Entities (residential property, commercial property, business) are
 *    the only things people connect through.
 *
 *  The replacement flow is "Add this person to one of my entities" — see
 *  the Add-to-entity flow section in
 *  `.local/tasks/entity-model-architecture-proposal.md` and the proposal
 *  doc at `docs/architecture/entity-model-proposal.md`.
 *
 *  Why this file still exists:
 *    - The avatar profile's primary Connect button is GONE (see
 *      PublicProfileModal.tsx) but a few legacy surfaces still call this
 *      sheet to manage existing connection rows during Phase 1 (e.g.
 *      "Change relationship" on an existing legacy connection, the inbox
 *      blocked-banner one-tap classifier, the people-search modal).
 *
 *  Rules for any code touching this file:
 *    1. Do NOT add this sheet to any new surface.
 *    2. Do NOT add new kinds beyond the existing client/core/collaborator
 *       triplet — those are legacy categories tied to user_connections.
 *    3. The right replacement when you find a tempting avatar surface is
 *       a picker that asks "Which of MY entities are you adding them to?"
 *       and "How are they participating in that entity?" — not this sheet.
 * ============================================================================
 */
import React, { useEffect, useMemo, useState } from "react";
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { ConnectionKind } from "@workspace/api-client-react";

import { useColors } from "@/hooks/useColors";

const PERSONAL_NOTE_MAX = 500;

type KindOption = {
  kind: ConnectionKind;
  title: string;
  subtitle: string;
  icon: keyof typeof Feather.glyphMap;
};

// #645 — Single source of truth for the connection-kind picker. Used by
// the public profile modal *and* the inbox blocked banner so power users
// can classify the relationship up front from either entry point.
export const KIND_OPTIONS: KindOption[] = [
  { kind: "client", title: "Add as Client", subtitle: "Someone you serve or work for", icon: "briefcase" },
  { kind: "core", title: "Add as Core", subtitle: "Part of your internal team", icon: "shield" },
  { kind: "collaborator", title: "Add as Collaborator", subtitle: "External contributor or partner", icon: "users" },
];

interface Props {
  visible: boolean;
  onClose: () => void;
  /**
   * Fired when the user picks a connection kind. The optional
   * `personalNote` is the trimmed contents of the in-sheet textarea —
   * passed straight through to `POST /users/:userId/connect` so it
   * lands on the recipient's invite *and* in the system-style
   * team-up-request inbox message that #656 introduces.
   */
  onSelect: (kind: ConnectionKind, personalNote?: string) => void;
  pending?: boolean;
  /** Show a check mark next to this kind (used when changing an existing connection). */
  selectedKind?: ConnectionKind | null;
  /**
   * Highlight one option as the recommended/default choice. The matching
   * row is reordered to the top and tagged "Recommended" so the
   * historical one-tap default (e.g. "collaborator" from the inbox
   * blocked banner) stays the obvious pick.
   */
  recommendedKind?: ConnectionKind | null;
  title?: string;
  subtitle?: string;
  /**
   * When true, render the optional personal-note text input above the
   * kind rows so the requester can include a short message that lands
   * with the team-up request (#656). Off by default to preserve the
   * existing single-tap UX from surfaces that don't want a composer
   * (e.g. switching kind on an already-accepted connection).
   */
  showPersonalNote?: boolean;
  testID?: string;
}

export function ConnectionKindChooser({
  visible,
  onClose,
  onSelect,
  pending = false,
  selectedKind = null,
  recommendedKind = null,
  title = "Why are you connecting?",
  subtitle = "Choose the relationship that best fits.",
  showPersonalNote = false,
  testID,
}: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();

  // Reset the note whenever the sheet is dismissed/reopened so a stale
  // draft from a previous request doesn't bleed into the next one.
  const [personalNote, setPersonalNote] = useState("");
  useEffect(() => {
    if (!visible) setPersonalNote("");
  }, [visible]);

  const orderedOptions = useMemo(() => {
    if (!recommendedKind) return KIND_OPTIONS;
    const recommended = KIND_OPTIONS.find((o) => o.kind === recommendedKind);
    if (!recommended) return KIND_OPTIONS;
    return [recommended, ...KIND_OPTIONS.filter((o) => o.kind !== recommendedKind)];
  }, [recommendedKind]);

  const handleSelect = (kind: ConnectionKind) => {
    const trimmed = personalNote.trim();
    onSelect(kind, showPersonalNote && trimmed ? trimmed : undefined);
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.sheetBackdrop} onPress={onClose} testID={testID ? `${testID}-backdrop` : undefined}>
        <Pressable
          style={[
            styles.sheet,
            {
              backgroundColor: colors.card,
              borderColor: colors.border,
              paddingBottom: insets.bottom + 16,
            },
          ]}
          onPress={() => {}}
          testID={testID}
        >
          <Text style={[styles.sheetTitle, { color: colors.foreground }]}>{title}</Text>
          <Text style={[styles.sheetSubtitle, { color: colors.mutedForeground }]}>{subtitle}</Text>
          {showPersonalNote ? (
            <View style={styles.noteWrap}>
              <TextInput
                value={personalNote}
                onChangeText={(text) =>
                  setPersonalNote(text.length > PERSONAL_NOTE_MAX ? text.slice(0, PERSONAL_NOTE_MAX) : text)
                }
                placeholder="Add a short note (optional)"
                placeholderTextColor={colors.mutedForeground}
                multiline
                editable={!pending}
                maxLength={PERSONAL_NOTE_MAX}
                style={[
                  styles.noteInput,
                  {
                    color: colors.foreground,
                    backgroundColor: colors.muted,
                    borderColor: colors.border,
                  },
                ]}
                testID="connection-kind-note-input"
              />
              <Text style={[styles.noteCounter, { color: colors.mutedForeground }]}>
                {personalNote.length}/{PERSONAL_NOTE_MAX}
              </Text>
            </View>
          ) : (
            <View style={{ height: 8 }} />
          )}
          {orderedOptions.map((opt, idx) => {
            const isRecommended = recommendedKind === opt.kind;
            return (
              <Pressable
                key={opt.kind}
                onPress={() => handleSelect(opt.kind)}
                disabled={pending}
                accessibilityRole="button"
                accessibilityLabel={opt.title}
                testID={`connection-kind-${opt.kind}`}
                style={[
                  styles.sheetRow,
                  {
                    borderTopColor: colors.border,
                    borderTopWidth: idx === 0 ? 0 : StyleSheet.hairlineWidth,
                    opacity: pending ? 0.6 : 1,
                  },
                ]}
              >
                <View style={[styles.sheetIcon, { backgroundColor: colors.muted }]}>
                  <Feather name={opt.icon} size={16} color={colors.foreground} />
                </View>
                <View style={{ flex: 1 }}>
                  <View style={styles.titleRow}>
                    <Text style={[styles.sheetRowTitle, { color: colors.foreground }]}>{opt.title}</Text>
                    {isRecommended ? (
                      <View
                        style={[
                          styles.recommendedPill,
                          { backgroundColor: colors.muted, borderColor: colors.border },
                        ]}
                      >
                        <Text style={[styles.recommendedPillText, { color: colors.mutedForeground }]}>
                          Recommended
                        </Text>
                      </View>
                    ) : null}
                  </View>
                  <Text style={[styles.sheetRowSubtitle, { color: colors.mutedForeground }]}>
                    {opt.subtitle}
                  </Text>
                </View>
                {selectedKind === opt.kind ? (
                  <Feather name="check" size={18} color={colors.foreground} />
                ) : null}
              </Pressable>
            );
          })}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  sheetBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "flex-end",
  },
  sheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 16,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: 1,
  },
  sheetTitle: { fontSize: 17, fontFamily: "Inter_700Bold" },
  sheetSubtitle: { fontSize: 13, fontFamily: "Inter_500Medium", marginTop: 4 },
  sheetRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 14,
  },
  sheetIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  sheetRowTitle: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  sheetRowSubtitle: { fontSize: 12, fontFamily: "Inter_500Medium", marginTop: 2 },
  recommendedPill: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  recommendedPillText: { fontSize: 10, fontFamily: "Inter_600SemiBold", letterSpacing: 0.3 },
  noteWrap: { marginTop: 12, marginBottom: 4 },
  noteInput: {
    minHeight: 72,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    fontFamily: "Inter_500Medium",
    textAlignVertical: "top",
  },
  noteCounter: {
    fontSize: 11,
    fontFamily: "Inter_500Medium",
    marginTop: 4,
    textAlign: "right",
  },
});
