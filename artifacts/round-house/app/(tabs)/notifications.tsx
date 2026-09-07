import React, { useCallback, useMemo } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useInfiniteQuery, useQueryClient, type InfiniteData } from "@tanstack/react-query";
import {
  getListMyEntitiesQueryKey,
  getListMyEntityThreadsQueryKey,
  listNotifications,
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useRespondToEntityMembership,
} from "@workspace/api-client-react";
import type {
  ListNotificationsResponse,
  NotificationItem,
} from "@workspace/api-client-react";

import { useColors } from "@/hooks/useColors";
import { EmptyState } from "@/components/EmptyState";
import { TopBarAccountIdentity } from "@/components/TopBarAvatar";
import { navigateToPushTarget } from "@/app/_layout";
import type { PushDeepLink } from "@/lib/pushNotifications";

const NOTIFICATIONS_QUERY_KEY = ["/api/notifications", "infinite"] as const;
const NOTIFICATIONS_BADGE_KEY = ["/api/notifications"] as const;
type NotificationsInfiniteData = InfiniteData<ListNotificationsResponse, string | undefined>;

function iconForType(type: string): keyof typeof Feather.glyphMap {
  if (type.startsWith("work_order_comment")) return "message-square";
  if (type.startsWith("work_order")) return "tool";
  if (type.startsWith("due_date_request")) return "calendar";
  if (type === "question_asked" || type === "question_answered") return "help-circle";
  if (type === "request_received") return "send";
  if (type === "due_date_changed") return "calendar";
  if (type === "rating") return "star";
  if (type === "log") return "clipboard";
  if (type === "assignment" || type === "reassignment") return "user-plus";
  if (type === "unassignment") return "user-minus";
  if (type === "message") return "mail";
  if (type === "invite") return "user-plus";
  if (type === "entity_invite") return "user-plus";
  if (type === "entity_request") return "user-plus";
  if (type === "entity_member_accepted") return "check-circle";
  if (type === "standard_overdue") return "alert-circle";
  return "bell";
}

function formatRelative(iso: string): string {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "";
  const diffMs = Date.now() - t;
  const min = Math.floor(diffMs / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hrs = Math.floor(min / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function deepLinkFromNotification(n: NotificationItem): PushDeepLink | null {
  const dl = n.deepLink;
  if (!dl) return null;
  if (!dl.workOrderId && !dl.propertyId && !dl.logId) return null;
  return {
    workOrderId: dl.workOrderId,
    propertyId: dl.propertyId,
    logId: dl.logId,
    standardId: dl.standardId,
    type: n.type,
    tab: dl.tab,
  };
}

export default function NotificationsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const router = useRouter();

  const {
    data,
    isLoading,
    isRefetching,
    refetch,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery<
    ListNotificationsResponse,
    Error,
    NotificationsInfiniteData,
    typeof NOTIFICATIONS_QUERY_KEY,
    string | undefined
  >({
    queryKey: NOTIFICATIONS_QUERY_KEY,
    initialPageParam: undefined,
    queryFn: ({ pageParam, signal }) =>
      listNotifications(pageParam ? { cursor: pageParam } : undefined, { signal }),
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });

  const markAll = useMarkAllNotificationsRead();
  const markOne = useMarkNotificationRead();
  const respondMembership = useRespondToEntityMembership();

  const notifications = useMemo(
    () => data?.pages.flatMap((p) => p.notifications) ?? [],
    [data],
  );
  const unreadCount = data?.pages[0]?.unreadCount ?? 0;

  const patchBadgeUnread = useCallback(
    (updater: (count: number) => number) => {
      const previousBadge =
        queryClient.getQueryData<ListNotificationsResponse>(NOTIFICATIONS_BADGE_KEY);
      if (!previousBadge) return;
      queryClient.setQueryData<ListNotificationsResponse>(NOTIFICATIONS_BADGE_KEY, {
        ...previousBadge,
        unreadCount: Math.max(0, updater(previousBadge.unreadCount)),
      });
    },
    [queryClient],
  );

  const optimisticMarkRead = useCallback(
    (id: number) => {
      const previous = queryClient.getQueryData<NotificationsInfiniteData>(
        NOTIFICATIONS_QUERY_KEY,
      );
      if (!previous) {
        patchBadgeUnread((c) => c - 1);
        return;
      }
      let removedUnread = 0;
      const pages = previous.pages.map((page) => ({
        ...page,
        notifications: page.notifications.map((n) => {
          if (n.id === id && !n.isRead) {
            removedUnread = 1;
            return { ...n, isRead: true };
          }
          return n;
        }),
      }));
      if (removedUnread && pages.length > 0) {
        pages[0] = {
          ...pages[0],
          unreadCount: Math.max(0, pages[0].unreadCount - removedUnread),
        };
      }
      queryClient.setQueryData<NotificationsInfiniteData>(NOTIFICATIONS_QUERY_KEY, {
        ...previous,
        pages,
      });
      if (removedUnread) patchBadgeUnread((c) => c - removedUnread);
    },
    [patchBadgeUnread, queryClient],
  );

  const optimisticMarkAll = useCallback(() => {
    const previous = queryClient.getQueryData<NotificationsInfiniteData>(
      NOTIFICATIONS_QUERY_KEY,
    );
    if (previous) {
      queryClient.setQueryData<NotificationsInfiniteData>(NOTIFICATIONS_QUERY_KEY, {
        ...previous,
        pages: previous.pages.map((page, index) => ({
          ...page,
          notifications: page.notifications.map((n) => ({ ...n, isRead: true })),
          unreadCount: index === 0 ? 0 : page.unreadCount,
        })),
      });
    }
    patchBadgeUnread(() => 0);
  }, [patchBadgeUnread, queryClient]);

  const refreshAll = useCallback(() => {
    refetch();
    queryClient.invalidateQueries({ queryKey: NOTIFICATIONS_BADGE_KEY });
  }, [queryClient, refetch]);

  const handleEndReached = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    }
  }, [fetchNextPage, hasNextPage, isFetchingNextPage]);

  const respondToMembership = useCallback(
    (n: NotificationItem, action: "accept" | "decline") => {
      const memberId = n.relatedId ? parseInt(n.relatedId, 10) : NaN;
      if (!Number.isFinite(memberId)) {
        Alert.alert("Can't respond", "This invite is no longer available.");
        return;
      }
      respondMembership.mutate(
        { memberId, data: { action } },
        {
          onSuccess: () => {
            if (!n.isRead) {
              optimisticMarkRead(n.id);
              markOne.mutate({ notificationId: n.id });
            }
            // Membership status flipped — propagate to anywhere
            // that lists entities, members, or entity threads.
            queryClient.invalidateQueries({
              queryKey: getListMyEntitiesQueryKey(),
            });
            queryClient.invalidateQueries({
              queryKey: getListMyEntityThreadsQueryKey(),
            });
            queryClient.invalidateQueries({
              queryKey: ["/api/entities/me/invites"],
            });
            queryClient.invalidateQueries({
              queryKey: ["/api/users/me/relationships"],
            });
            refreshAll();
          },
          onError: (err: unknown) => {
            const msg =
              err instanceof Error ? err.message : "Please try again.";
            Alert.alert("Couldn't respond", msg);
            refreshAll();
          },
        },
      );
    },
    [markOne, optimisticMarkRead, queryClient, refreshAll, respondMembership],
  );

  const handlePress = useCallback(
    (n: NotificationItem) => {
      if (n.type === "entity_invite" || n.type === "entity_request") {
        const acceptLabel =
          n.type === "entity_invite" ? "Accept" : "Approve";
        const declineLabel =
          n.type === "entity_invite" ? "Decline" : "Reject";
        const promptTitle = n.title || "Respond to invite";
        const promptBody = n.body || "Accept or decline this invite.";
        Alert.alert(promptTitle, promptBody, [
          { text: "Cancel", style: "cancel" },
          {
            text: declineLabel,
            style: "destructive",
            onPress: () => respondToMembership(n, "decline"),
          },
          {
            text: acceptLabel,
            onPress: () => respondToMembership(n, "accept"),
          },
        ]);
        return;
      }
      if (!n.isRead) {
        optimisticMarkRead(n.id);
        markOne.mutate(
          { notificationId: n.id },
          { onSettled: refreshAll },
        );
      }
      const link = deepLinkFromNotification(n);
      if (link) navigateToPushTarget(link);
    },
    [markOne, optimisticMarkRead, refreshAll, respondToMembership],
  );

  const handleMarkAll = useCallback(() => {
    if (unreadCount === 0) return;
    optimisticMarkAll();
    markAll.mutate(undefined, { onSettled: refreshAll });
  }, [markAll, optimisticMarkAll, refreshAll, unreadCount]);

  const headerHeight = insets.top + 56;

  const listEmpty = useMemo(
    () =>
      isLoading ? (
        <View style={styles.loading}>
          <ActivityIndicator color={colors.mutedForeground} />
        </View>
      ) : (
        <View style={styles.empty}>
          <EmptyState
            icon="bell"
            title="No notifications yet"
            description="When jobs change, comments come in, or alerts fire, you'll see them here."
          />
        </View>
      ),
    [colors.mutedForeground, isLoading],
  );

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <View
        style={[
          styles.header,
          {
            paddingTop: insets.top + 8,
            height: headerHeight,
            borderBottomColor: colors.border,
            backgroundColor: colors.background,
          },
        ]}
      >
        <View style={styles.headerLeft}>
          {/* Suppress the auto-injected InboxButton: this screen IS the
              notifications inbox, and the bespoke "Inbox" link below already
              navigates to /inbox (messages). Two mail icons in one header
              would be confusing. */}
          <TopBarAccountIdentity showInbox={false} />
        </View>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Open inbox"
          onPress={() => router.push("/inbox" as never)}
          hitSlop={8}
          style={styles.headerInboxBtn}
        >
          <Feather name="mail" size={20} color={colors.primary} />
          <Text style={[styles.headerAction, { color: colors.primary }]}>
            Inbox
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Mark all notifications as read"
          accessibilityState={{ disabled: unreadCount === 0 }}
          onPress={handleMarkAll}
          disabled={unreadCount === 0 || markAll.isPending}
          hitSlop={8}
        >
          <Text
            style={[
              styles.headerAction,
              {
                color:
                  unreadCount === 0 ? colors.mutedForeground : colors.primary,
              },
            ]}
          >
            Mark all read
          </Text>
        </TouchableOpacity>
      </View>

      <FlatList
        data={notifications}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={[
          styles.listContent,
          notifications.length === 0 && styles.listContentEmpty,
          { paddingBottom: insets.bottom + 96 },
        ]}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={() => refetch()}
            tintColor={colors.mutedForeground}
          />
        }
        ListEmptyComponent={listEmpty}
        onEndReached={handleEndReached}
        onEndReachedThreshold={0.4}
        ListFooterComponent={
          isFetchingNextPage ? (
            <View style={styles.footerLoading}>
              <ActivityIndicator color={colors.mutedForeground} size="small" />
            </View>
          ) : !hasNextPage && notifications.length > 0 ? (
            <View style={styles.footerEnd}>
              <Text style={[styles.footerEndText, { color: colors.mutedForeground }]}>
                You're all caught up
              </Text>
            </View>
          ) : null
        }
        renderItem={({ item }) => {
          const iconName = iconForType(item.type);
          const isInviteAction =
            item.type === "entity_invite" || item.type === "entity_request";
          const tappable =
            isInviteAction ||
            !!deepLinkFromNotification(item) ||
            !item.isRead;
          return (
            <Pressable
              onPress={() => handlePress(item)}
              disabled={!tappable}
              android_ripple={{ color: colors.muted }}
              style={({ pressed }) => [
                styles.row,
                {
                  backgroundColor: item.isRead
                    ? colors.background
                    : colors.scoreBackground,
                  borderBottomColor: colors.border,
                  opacity: pressed ? 0.85 : 1,
                },
              ]}
            >
              <View
                style={[
                  styles.iconWrap,
                  { backgroundColor: colors.muted },
                ]}
              >
                <Feather
                  name={iconName}
                  size={18}
                  color={item.isRead ? colors.mutedForeground : colors.primary}
                />
              </View>
              <View style={styles.body}>
                <View style={styles.rowTop}>
                  <Text
                    numberOfLines={1}
                    style={[
                      styles.title,
                      {
                        color: colors.foreground,
                        fontWeight: item.isRead ? "500" : "700",
                      },
                    ]}
                  >
                    {item.title}
                  </Text>
                  <Text
                    style={[
                      styles.time,
                      { color: colors.mutedForeground },
                    ]}
                  >
                    {formatRelative(item.createdAt)}
                  </Text>
                </View>
                <Text
                  numberOfLines={2}
                  style={[
                    styles.bodyText,
                    { color: colors.mutedForeground },
                  ]}
                >
                  {item.body}
                </Text>
              </View>
              {!item.isRead && (
                <View
                  style={[styles.unreadDot, { backgroundColor: colors.primary }]}
                />
              )}
            </Pressable>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingBottom: 12,
  },
  headerLeft: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  headerTitle: {
    fontSize: 22,
    fontFamily: "Inter_700Bold",
  },
  headerAction: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
  },
  headerInboxBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginRight: 16,
  },
  listContent: { paddingTop: 4 },
  listContentEmpty: { flexGrow: 1 },
  loading: { flex: 1, alignItems: "center", justifyContent: "center", padding: 48 },
  footerLoading: { paddingVertical: 16, alignItems: "center" },
  footerEnd: { paddingVertical: 20, alignItems: "center" },
  footerEndText: {
    fontSize: 12,
    fontFamily: "Inter_500Medium",
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
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  body: { flex: 1, gap: 4 },
  rowTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  title: {
    flex: 1,
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
  },
  time: {
    fontSize: 12,
    fontFamily: "Inter_500Medium",
  },
  bodyText: {
    fontSize: 13,
    lineHeight: 18,
    fontFamily: "Inter_400Regular",
  },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginTop: 6,
    marginLeft: 4,
  },
});
