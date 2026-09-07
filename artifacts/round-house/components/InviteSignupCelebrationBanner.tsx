import React, { useMemo, useRef, useEffect } from "react";
import { Animated, Easing, Pressable, StyleSheet, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  getListNotificationsQueryKey,
  useListNotifications,
  useMarkNotificationRead,
} from "@workspace/api-client-react";
import type { NotificationItem } from "@workspace/api-client-react";

import { useColors } from "@/hooks/useColors";
import { RisingSunSticker } from "@/components/RisingSunSticker";

const NOTIFICATIONS_QUERY_KEY = getListNotificationsQueryKey();

function findUnreadInviteSignup(
  notifications: NotificationItem[] | undefined,
): NotificationItem | null {
  if (!notifications) return null;
  for (const n of notifications) {
    if (n.type === "app_invite_signup" && !n.isRead) return n;
  }
  return null;
}

export function InviteSignupCelebrationBanner() {
  const colors = useColors();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { data } = useListNotifications(undefined, {
    query: { queryKey: NOTIFICATIONS_QUERY_KEY },
  });
  const markRead = useMarkNotificationRead();
  const opacity = useRef(new Animated.Value(0)).current;

  const notif = useMemo(
    () => findUnreadInviteSignup(data?.notifications),
    [data?.notifications],
  );

  useEffect(() => {
    if (!notif) return;
    opacity.setValue(0);
    Animated.timing(opacity, {
      toValue: 1,
      duration: 260,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [notif, opacity]);

  if (!notif) return null;

  const dismiss = (navigate: boolean) => {
    const id = notif.id;
    markRead.mutate(
      { notificationId: id },
      {
        onSettled: () => {
          void queryClient.invalidateQueries({
            queryKey: NOTIFICATIONS_QUERY_KEY,
          });
        },
      },
    );
    if (navigate) router.push("/people-i-invited");
  };

  return (
    <Animated.View
      style={[
        styles.wrap,
        {
          backgroundColor: colors.card,
          borderColor: colors.border,
          shadowColor: colors.foreground,
          opacity,
        },
      ]}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${notif.title}. Tap to see people you've invited.`}
        onPress={() => dismiss(true)}
        style={({ pressed }) => [styles.pressable, { opacity: pressed ? 0.85 : 1 }]}
      >
        <View style={styles.sticker}>
          <RisingSunSticker size={44} points={10} />
        </View>
        <View style={styles.textWrap}>
          <Text style={[styles.title, { color: colors.foreground }]} numberOfLines={2}>
            {notif.title}
          </Text>
          {notif.body ? (
            <Text
              style={[styles.body, { color: colors.mutedForeground }]}
              numberOfLines={2}
            >
              {notif.body}
            </Text>
          ) : null}
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Dismiss"
          hitSlop={10}
          onPress={() => dismiss(false)}
          style={styles.closeBtn}
        >
          <Feather name="x" size={16} color={colors.mutedForeground} />
        </Pressable>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginHorizontal: 16,
    marginTop: 12,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    shadowOpacity: 0.12,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  pressable: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    paddingLeft: 12,
    paddingRight: 8,
    gap: 12,
  },
  sticker: {
    width: 44,
    height: 44,
  },
  textWrap: {
    flex: 1,
    gap: 2,
  },
  title: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
  },
  body: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    lineHeight: 17,
  },
  closeBtn: {
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 14,
  },
});
