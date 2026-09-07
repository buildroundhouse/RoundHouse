import React, { useCallback, useMemo, useRef, useState } from "react";
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
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListEntityMessages,
  useSendEntityMessage,
  getListEntityMessagesQueryKey,
  getListMyEntityThreadsQueryKey,
  type MessageItem,
} from "@workspace/api-client-react";

import { useColors } from "@/hooks/useColors";
import { useProfile } from "@/lib/profile";
import { MessageRow } from "@/components/MessageRow";
import { EmptyState } from "@/components/EmptyState";

/**
 * Task #721 — Avatar-to-avatar direct messaging was removed during the
 * entity-membership-and-messaging cutover. This route used to fetch a
 * conversation by the other user's clerkId / outwardAccountId via the
 * removed `useGetConversation` / `useSendMessage` hooks.
 *
 * It now renders an entity-scoped thread when the URL segment parses
 * as a numeric entityId (the surface the rewritten `/inbox` index
 * pushes to). Any other path segment — including a stale
 * `/inbox/<clerkId>?compose=1&clerk=<clerkId>` deep link from a
 * pre-cutover "Message" affordance — lands on a friendly empty state
 * instead of the global error boundary.
 */
export default function EntityThreadScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { profile } = useProfile();

  const params = useLocalSearchParams<{ otherUserId: string }>();
  const rawParam = params.otherUserId ?? "";
  const parsedEntityId = Number.parseInt(rawParam, 10);
  const entityId =
    Number.isFinite(parsedEntityId) &&
    parsedEntityId > 0 &&
    String(parsedEntityId) === rawParam
      ? parsedEntityId
      : null;

  const listRef = useRef<FlatList<MessageItem>>(null);
  const [draft, setDraft] = useState("");

  const { data, isLoading, isRefetching, refetch } = useListEntityMessages(
    entityId ?? 0,
    undefined,
    {
      query: {
        queryKey:
          entityId != null
            ? getListEntityMessagesQueryKey(entityId)
            : ["entity-thread:invalid"],
        enabled: entityId != null,
        refetchOnWindowFocus: true,
      },
    },
  );

  const messages = useMemo<MessageItem[]>(
    () => data?.messages ?? [],
    [data],
  );

  const sendMutation = useSendEntityMessage();

  const handleSend = useCallback(() => {
    const content = draft.trim();
    if (!content || entityId == null || sendMutation.isPending) return;
    sendMutation.mutate(
      { entityId, data: { content } },
      {
        onSuccess: () => {
          setDraft("");
          queryClient.invalidateQueries({
            queryKey: getListEntityMessagesQueryKey(entityId),
          });
          queryClient.invalidateQueries({
            queryKey: getListMyEntityThreadsQueryKey(),
          });
        },
      },
    );
  }, [draft, entityId, queryClient, sendMutation]);

  if (entityId == null) {
    return (
      <View style={[styles.root, { backgroundColor: colors.background }]}>
        <Stack.Screen options={{ title: "Conversation unavailable" }} />
        <View style={styles.empty}>
          <EmptyState
            icon="mail"
            title="Conversation unavailable"
            description="Direct messaging has moved into property and business threads. Open the inbox to find the right thread."
            actionLabel="Open inbox"
            onAction={() => router.replace("/inbox" as never)}
          />
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <Stack.Screen options={{ title: "Thread" }} />
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
            <MessageRow message={item} meClerkId={profile?.clerkId ?? null} />
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
                  title="Start the conversation"
                  description="Type a message below — every approved member of this thread will see it."
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
            styles.composer,
            {
              borderTopColor: colors.border,
              paddingBottom: Math.max(insets.bottom, 8),
              backgroundColor: colors.background,
            },
          ]}
        >
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder="Message"
            placeholderTextColor={colors.mutedForeground}
            multiline
            testID="message-composer-input"
            style={[
              styles.input,
              {
                color: colors.foreground,
                backgroundColor: colors.muted,
                borderColor: colors.border,
              },
            ]}
          />
          <Pressable
            onPress={handleSend}
            disabled={!draft.trim() || sendMutation.isPending}
            accessibilityRole="button"
            accessibilityLabel="Send message"
            accessibilityState={{
              disabled: !draft.trim() || sendMutation.isPending,
            }}
            testID="message-composer-send"
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
            <Feather name="send" size={18} color={colors.primaryForeground} />
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  kav: { flex: 1 },
  listContent: { paddingVertical: 12, flexGrow: 1 },
  listContentEmpty: { justifyContent: "center" },
  loading: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 48,
  },
  empty: { flex: 1, justifyContent: "center" },
  composer: {
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
    maxHeight: 120,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    fontSize: 15,
    fontFamily: "Inter_400Regular",
  },
  sendBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
});
