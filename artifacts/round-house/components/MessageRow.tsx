import React from "react";
import { Image, StyleSheet, Text, View } from "react-native";
import type { MessageItem } from "@workspace/api-client-react";
import { useColors } from "@/hooks/useColors";
import { ConciergeDraftBadge } from "@/components/ConciergeDraftBadge";

interface Props {
  message: MessageItem;
  /** Clerk id of the signed-in user — used to align the bubble left/right. */
  meClerkId: string | null;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

/**
 * A single message bubble inside a thread. Lays out left for received
 * messages, right for the signed-in user's own copy. When the message was
 * drafted via `POST /concierge/send-draft` (`source === "concierge_draft"`)
 * a small "drafted with concierge" pill appears next to the bubble — the
 * badge is rendered for both the recipient and the sender so everyone can
 * see how the wording was composed.
 */
export function MessageRow({ message, meClerkId }: Props) {
  const colors = useColors();
  const isMine = !!meClerkId && message.senderClerkId === meClerkId;
  const isConciergeDraft = message.source === "concierge_draft";
  // #599 — A team-up personal note ridden along into the new thread on
  // accept. Render as a centered, quoted opener so it reads as context
  // for the conversation rather than a regular DM, regardless of which
  // side is viewing it.
  const isTeamUpNote = message.source === "team_up_note";
  // #603 — System "you're now connected" anchor inserted on accept so
  // the freshly-unlocked thread doesn't open completely blank. Render
  // as a centered system pill — no avatar, no left/right alignment —
  // so it reads as a system event rather than either side's DM.
  const isSystemConnected = message.source === "system_connected";
  // #656 — System summary inserted the moment a team-up request is
  // sent ("Asked to team up as Collaborator", with the optional
  // personal note quoted on a second line). Same centered-pill
  // treatment as system_connected, with the personal note rendered
  // as a quoted opener directly below the summary so it doesn't
  // disappear inside the pill.
  const isTeamUpRequest = message.source === "team_up_request";

  if (isSystemConnected) {
    return (
      <View style={styles.openerRow}>
        <View
          style={[
            styles.systemPill,
            { backgroundColor: colors.muted, borderColor: colors.border },
          ]}
        >
          <Text style={[styles.systemText, { color: colors.mutedForeground }]}>
            {message.content}
          </Text>
        </View>
      </View>
    );
  }

  if (isTeamUpRequest) {
    // The server stores the optional note as a second paragraph wrapped
    // in straight quotes (`summary\n\n"<note>"`). Split here so the
    // summary stays a clean centered pill and the quoted note renders
    // beneath it in the same italic style as `team_up_note`.
    const [summaryLine, ...rest] = message.content.split("\n\n");
    const noteRaw = rest.join("\n\n").trim();
    const note =
      noteRaw.startsWith('"') && noteRaw.endsWith('"')
        ? noteRaw.slice(1, -1)
        : noteRaw;
    return (
      <View style={styles.openerRow}>
        <View
          style={[
            styles.systemPill,
            { backgroundColor: colors.muted, borderColor: colors.border },
          ]}
        >
          <Text style={[styles.systemText, { color: colors.mutedForeground }]}>
            {summaryLine}
          </Text>
        </View>
        {note ? (
          <Text
            style={[
              styles.openerQuote,
              { color: colors.foreground, marginTop: 8 },
            ]}
          >
            {`“${note}”`}
          </Text>
        ) : null}
      </View>
    );
  }

  if (isTeamUpNote) {
    const senderLabel = message.sender?.name ?? "They";
    return (
      <View style={styles.openerRow}>
        <View
          style={[
            styles.openerCard,
            { backgroundColor: colors.muted, borderColor: colors.border },
          ]}
        >
          <Text
            style={[styles.openerCaption, { color: colors.mutedForeground }]}
          >
            {`From ${senderLabel}'s team-up request`}
          </Text>
          <Text style={[styles.openerQuote, { color: colors.foreground }]}>
            {`“${message.content}”`}
          </Text>
          <Text style={[styles.time, { color: colors.mutedForeground }]}>
            {formatTime(message.createdAt)}
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.row, isMine ? styles.rowMine : styles.rowTheirs]}>
      {!isMine && message.sender.avatarUrl ? (
        <Image source={{ uri: message.sender.avatarUrl }} style={styles.avatar} />
      ) : !isMine ? (
        <View style={[styles.avatar, { backgroundColor: colors.muted }]} />
      ) : null}
      <View style={[styles.bubbleColumn, isMine ? styles.bubbleColumnMine : null]}>
        <View
          style={[
            styles.bubble,
            isMine
              ? { backgroundColor: colors.primary, borderColor: colors.primary }
              : { backgroundColor: colors.muted, borderColor: colors.border },
          ]}
        >
          <Text
            style={[
              styles.bubbleText,
              { color: isMine ? colors.primaryForeground : colors.foreground },
            ]}
          >
            {message.content}
          </Text>
        </View>
        <View style={[styles.metaRow, isMine ? styles.metaRowMine : null]}>
          {isConciergeDraft ? <ConciergeDraftBadge /> : null}
          <Text style={[styles.time, { color: colors.mutedForeground }]}>
            {formatTime(message.createdAt)}
          </Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  rowMine: { justifyContent: "flex-end" },
  rowTheirs: { justifyContent: "flex-start" },
  avatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
  },
  bubbleColumn: {
    maxWidth: "78%",
    gap: 4,
    alignItems: "flex-start",
  },
  bubbleColumnMine: { alignItems: "flex-end" },
  bubble: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
  },
  bubbleText: {
    fontSize: 15,
    fontFamily: "Inter_400Regular",
    lineHeight: 20,
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  metaRowMine: { justifyContent: "flex-end" },
  time: {
    fontSize: 11,
    fontFamily: "Inter_500Medium",
  },
  openerRow: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    alignItems: "center",
  },
  openerCard: {
    maxWidth: "92%",
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 6,
    alignItems: "center",
  },
  openerCaption: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  openerQuote: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    lineHeight: 20,
    fontStyle: "italic",
    textAlign: "center",
  },
  systemPill: {
    maxWidth: "92%",
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  systemText: {
    fontSize: 12,
    fontFamily: "Inter_500Medium",
    textAlign: "center",
  },
});
