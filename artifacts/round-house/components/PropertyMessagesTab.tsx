import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFocusEffect } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListPropertyMessages,
  useSendPropertyMessage,
  useMarkPropertyMessagesRead,
  getListPropertyMessagesQueryKey,
  type MessageItem,
} from "@workspace/api-client-react";

import { useColors } from "@/hooks/useColors";
import { MessageRow } from "@/components/MessageRow";
import { EmptyState } from "@/components/EmptyState";

// The inbox query key is defined in app/inbox.tsx as
// `["/api/properties/me/threads"]`. Re-stating it here (rather than
// exporting/importing) avoids a circular dep between a screen and a
// component it renders. Keep in sync with inbox.tsx.
const ENTITY_THREADS_QUERY_KEY = ["/api/properties/me/threads"] as const;

interface Props {
  propertyId: number;
  meClerkId: string | null;
}

/**
 * Entity-scoped message thread for a single property (§11 of the
 * entity-model proposal). Every approved member of the property sees
 * the same thread and receives in-app + push notifications when
 * someone posts. Recipient routing does not exist inside an entity —
 * membership is the gate.
 *
 * Layout mirrors the inbox thread screen so the chat affordances feel
 * familiar, but there's no team-up gate (no recipient → no DM gate to
 * surface). The mutation invalidates this property's query key and
 * the global inbox/messages keys so the unread badges stay in sync.
 */
export function PropertyMessagesTab({ propertyId, meClerkId }: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();

  const listRef = useRef<FlatList<MessageItem>>(null);
  const inputRef = useRef<TextInput>(null);
  const [draft, setDraft] = useState("");

  const {
    data,
    isLoading,
    isRefetching,
    refetch,
    error,
  } = useListPropertyMessages(
    propertyId,
    undefined,
    {
      query: {
        queryKey: getListPropertyMessagesQueryKey(propertyId),
        enabled: Number.isFinite(propertyId),
        refetchOnWindowFocus: true,
      },
    },
  );

  const messages = useMemo<MessageItem[]>(() => data?.messages ?? [], [data]);

  const sendMutation = useSendPropertyMessage();
  const markReadMutation = useMarkPropertyMessagesRead();

  /**
   * Stamp the membership's read cursor whenever the tab gains focus
   * (mount, navigating back to it, switching tabs). Best-effort —
   * a 403 means the user lost membership in this property mid-session
   * and the cursor write is moot anyway. We don't await it before
   * rendering; the cursor is a side-effect, not data we display.
   *
   * On success, invalidate the inbox query so the unread badge in the
   * Inbox tab refreshes the next time it's visible.
   */
  const markRead = useCallback(() => {
    if (!Number.isFinite(propertyId)) return;
    markReadMutation.mutate(
      { propertyId },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: ENTITY_THREADS_QUERY_KEY });
        },
      },
    );
  }, [propertyId, markReadMutation, queryClient]);

  // Mark on initial mount — useFocusEffect would fire later if the
  // screen mounts already focused. The effect dep on propertyId
  // re-stamps if the user navigates between properties without the
  // tab unmounting (rare but possible via deep links).
  useEffect(() => {
    markRead();
    // markRead identity is stable enough across renders (mutation
    // hooks return stable callbacks) — only refire on propertyId.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [propertyId]);

  useFocusEffect(
    useCallback(() => {
      markRead();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [propertyId]),
  );

  const handleSend = useCallback(() => {
    const content = draft.trim();
    if (!content || sendMutation.isPending) return;
    sendMutation.mutate(
      { propertyId, data: { content } },
      {
        onSuccess: () => {
          setDraft("");
          queryClient.invalidateQueries({
            queryKey: getListPropertyMessagesQueryKey(propertyId),
          });
          // Keep the global inbox surfaces fresh — they still show
          // legacy DM threads and the bell badge updates from these
          // keys.
          queryClient.invalidateQueries({ queryKey: ["/api/messages"] });
          queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
          // Sending implicitly "reads" everything older — refresh
          // the read cursor so this user's own message doesn't sit
          // in the next inbox render as a phantom unread blip.
          markRead();
        },
      },
    );
  }, [draft, propertyId, queryClient, sendMutation]);

  const accessForbidden =
    error != null &&
    typeof error === "object" &&
    "status" in error &&
    (error as { status?: number }).status === 403;

  if (accessForbidden) {
    return (
      <View
        style={[styles.gateRoot, { backgroundColor: colors.background }]}
        accessibilityRole="alert"
      >
        <EmptyState
          icon="lock"
          title="Members only"
          description="Only approved members of this property can read or post in this thread."
        />
      </View>
    );
  }

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <KeyboardAvoidingView
        style={styles.kav}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={insets.top + 56}
      >
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={(m) => String(m.id)}
          contentContainerStyle={[
            styles.listContent,
            messages.length === 0 && styles.listContentEmpty,
          ]}
          refreshControl={
            <RefreshControl
              refreshing={isRefetching}
              onRefresh={() => refetch()}
              tintColor={colors.mutedForeground}
            />
          }
          renderItem={({ item }) => (
            <MessageRow message={item} meClerkId={meClerkId} />
          )}
          ListEmptyComponent={
            isLoading ? (
              <View style={styles.loading}>
                <ActivityIndicator color={colors.mutedForeground} />
              </View>
            ) : (
              <View style={styles.empty}>
                <EmptyState
                  icon="message-circle"
                  title="Property thread"
                  description="Messages here go to everyone on this property's team. Type below to start."
                />
              </View>
            )
          }
          onContentSizeChange={() =>
            listRef.current?.scrollToEnd({ animated: false })
          }
        />

        <View
          style={[
            styles.inputBar,
            {
              borderTopColor: colors.border,
              backgroundColor: colors.background,
              paddingBottom: Math.max(insets.bottom, 8),
            },
          ]}
        >
          <TextInput
            ref={inputRef}
            value={draft}
            onChangeText={setDraft}
            placeholder="Message everyone on this property…"
            placeholderTextColor={colors.mutedForeground}
            style={[
              styles.input,
              {
                color: colors.foreground,
                backgroundColor: colors.muted,
                borderColor: colors.border,
              },
            ]}
            multiline
            editable={!sendMutation.isPending}
            accessibilityLabel="Property thread message"
            testID="property-message-input"
          />
          <Pressable
            onPress={handleSend}
            disabled={!draft.trim() || sendMutation.isPending}
            accessibilityRole="button"
            accessibilityLabel="Send message"
            accessibilityState={{
              disabled: !draft.trim() || sendMutation.isPending,
            }}
            testID="property-message-send"
            style={({ pressed }) => [
              styles.sendBtn,
              {
                backgroundColor: colors.primary,
                opacity:
                  !draft.trim() || sendMutation.isPending
                    ? 0.5
                    : pressed
                      ? 0.85
                      : 1,
              },
            ]}
          >
            {sendMutation.isPending ? (
              <ActivityIndicator color={colors.primaryForeground} size="small" />
            ) : (
              <Feather name="send" size={18} color={colors.primaryForeground} />
            )}
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  kav: {
    flex: 1,
  },
  gateRoot: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  listContent: {
    paddingVertical: 12,
    flexGrow: 1,
  },
  listContentEmpty: {
    justifyContent: "center",
  },
  loading: {
    paddingVertical: 40,
    alignItems: "center",
  },
  empty: {
    paddingHorizontal: 24,
    paddingVertical: 24,
    alignItems: "center",
  },
  inputBar: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 8,
    paddingHorizontal: 12,
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  input: {
    flex: 1,
    minHeight: 40,
    maxHeight: 140,
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 10,
    fontSize: 15,
    fontFamily: "Inter_400Regular",
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
  },
  sendBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
});
