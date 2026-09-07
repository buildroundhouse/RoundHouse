import React, { useCallback, useMemo } from "react";
import {
  ActivityIndicator,
  FlatList,
  Image,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Stack, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import {
  useListMyEntityThreads,
  getListMyEntityThreadsQueryKey,
  type EntityThreadItem,
} from "@workspace/api-client-react";

import { useColors } from "@/hooks/useColors";
import { EmptyState } from "@/components/EmptyState";

/**
 * Task #721 — Avatar-to-avatar direct messaging was removed during the
 * entity-membership-and-messaging cutover (`GET /api/messages*` and
 * `POST /api/messages/:otherTarget` are now `410 Gone`, and the
 * regenerated client no longer exports `useListConversations` /
 * `useGetConversation` / `useSendMessage`).
 *
 * This screen is now the entity-thread index. Each row is one of the
 * entities (property or business) the caller belongs to, with the
 * latest message preview and unread count. Tapping a row opens
 * `/inbox/<entityId>`, which renders the entity-scoped thread using
 * `useListEntityMessages` / `useSendEntityMessage`.
 *
 * The preview line on each row renders `${last.sender.name}: ${last.content}`
 * — that prefix is the surviving UI surface that consumes the per-skin
 * "show last initial only" rule (#640) for the *viewer* of someone
 * else's message (the server pre-shortens `lastMessage.sender.name`
 * per `formatOwnerNameForSkin` in `routes/messages.ts`'s
 * `listMyEntityThreads`). The privacy-toggle e2e plan
 * (`artifacts/round-house/e2e/privacy-toggle-end-to-end.test-plan.md`)
 * asserts on it via `testID = "entity-thread-preview-${entityId}"`.
 */
function formatRelative(iso: string): string {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "";
  const diffMs = Date.now() - t;
  const min = Math.floor(diffMs / 60000);
  if (min < 1) return "now";
  if (min < 60) return `${min}m`;
  const hrs = Math.floor(min / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d`;
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

export default function InboxScreen() {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const { data, isLoading, isRefetching, refetch } = useListMyEntityThreads({
    query: {
      queryKey: getListMyEntityThreadsQueryKey(),
      refetchOnWindowFocus: true,
    },
  });

  const threads = useMemo<EntityThreadItem[]>(
    () => data?.threads ?? [],
    [data],
  );

  const openThread = useCallback(
    (entityId: number) => {
      router.push(`/inbox/${entityId}` as never);
    },
    [router],
  );

  const listEmpty = useMemo(
    () =>
      isLoading ? (
        <View style={styles.loading}>
          <ActivityIndicator color={colors.mutedForeground} />
        </View>
      ) : (
        <View style={styles.empty}>
          <EmptyState
            icon="mail"
            title="No threads yet"
            description="When you join a property or business, its shared message thread will show up here."
          />
        </View>
      ),
    [colors.mutedForeground, isLoading],
  );

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <Stack.Screen options={{ title: "Inbox" }} />
      <FlatList
        data={threads}
        keyExtractor={(item) => `entity:${item.entityId}`}
        contentContainerStyle={[
          styles.listContent,
          threads.length === 0 && styles.listContentEmpty,
          { paddingBottom: insets.bottom + 24 },
        ]}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={refetch}
            tintColor={colors.mutedForeground}
          />
        }
        ListEmptyComponent={listEmpty}
        renderItem={({ item }) => {
          const last = item.lastMessage;
          const unread = item.unreadCount > 0;
          const previewText = last
            ? `${last.sender?.name ? `${last.sender.name}: ` : ""}${last.content}`
            : "No messages yet — tap to start the thread";
          const time = last ? formatRelative(last.createdAt) : "";
          const iconName =
            item.entityKind === "business" ? "briefcase" : "home";
          return (
            <Pressable
              onPress={() => openThread(item.entityId)}
              android_ripple={{ color: colors.muted }}
              accessibilityRole="button"
              accessibilityLabel={
                unread
                  ? `Open ${item.entityName} thread, unread`
                  : `Open ${item.entityName} thread`
              }
              testID={`entity-thread-row-${item.entityId}`}
              style={({ pressed }) => [
                styles.row,
                {
                  backgroundColor: unread
                    ? colors.scoreBackground
                    : colors.background,
                  borderBottomColor: colors.border,
                  opacity: pressed ? 0.85 : 1,
                },
              ]}
            >
              {item.coverPhotoUrl || item.logoUrl ? (
                <Image
                  source={{
                    uri: (item.coverPhotoUrl || item.logoUrl) as string,
                  }}
                  style={styles.avatar}
                />
              ) : (
                <View
                  style={[
                    styles.avatar,
                    styles.coverFallback,
                    { backgroundColor: item.coverColor || colors.muted },
                  ]}
                >
                  <Feather
                    name={iconName}
                    size={18}
                    color="rgba(255,255,255,0.92)"
                  />
                </View>
              )}
              <View style={styles.body}>
                <View style={styles.rowTop}>
                  <Text
                    numberOfLines={1}
                    style={[
                      styles.name,
                      {
                        color: colors.foreground,
                        fontWeight: unread ? "700" : "500",
                      },
                    ]}
                  >
                    {item.entityName}
                  </Text>
                  <Text
                    style={[styles.time, { color: colors.mutedForeground }]}
                  >
                    {time}
                  </Text>
                </View>
                <View style={styles.previewRow}>
                  <Text
                    numberOfLines={1}
                    testID={`entity-thread-preview-${item.entityId}`}
                    style={[
                      styles.preview,
                      {
                        color: colors.mutedForeground,
                        fontStyle: last ? "normal" : "italic",
                      },
                    ]}
                  >
                    {previewText}
                  </Text>
                </View>
              </View>
              {unread ? (
                <View
                  style={[
                    styles.unreadDot,
                    { backgroundColor: colors.primary },
                  ]}
                />
              ) : null}
            </Pressable>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  listContent: { paddingTop: 4 },
  listContentEmpty: { flexGrow: 1 },
  loading: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 48,
  },
  empty: { flex: 1, justifyContent: "center" },
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  avatar: { width: 44, height: 44, borderRadius: 22 },
  coverFallback: { alignItems: "center", justifyContent: "center" },
  body: { flex: 1, gap: 4 },
  rowTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  name: { flex: 1, fontSize: 15, fontFamily: "Inter_600SemiBold" },
  time: { fontSize: 12, fontFamily: "Inter_500Medium" },
  previewRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  preview: { flex: 1, fontSize: 13, fontFamily: "Inter_400Regular" },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginTop: 6,
    marginLeft: 4,
  },
});
