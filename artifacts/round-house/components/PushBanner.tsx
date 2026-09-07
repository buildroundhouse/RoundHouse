import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Animated,
  Easing,
  PanResponder,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { usePathname } from "expo-router";

import { useColors } from "@/hooks/useColors";
import {
  subscribeToForegroundPush,
  type ForegroundPushPayload,
  type PushDeepLink,
} from "@/lib/pushNotifications";

const AUTO_DISMISS_MS = 4500;
const SLIDE_DURATION = 220;
const DISMISS_TRANSLATE = -200;

interface BannerState {
  title: string;
  body: string;
  link: PushDeepLink | null;
}

interface Props {
  onPress: (link: PushDeepLink) => void;
}

function isOnTargetScreen(pathname: string, link: PushDeepLink | null): boolean {
  if (!link) return false;
  if (link.workOrderId && pathname.startsWith(`/work-order/${link.workOrderId}`)) {
    return true;
  }
  if (link.propertyId && pathname.startsWith(`/property/${link.propertyId}`)) {
    return true;
  }
  if (link.type === "reminder" && pathname.startsWith("/reminders")) {
    return true;
  }
  return false;
}

export function PushBanner({ onPress }: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  const [banner, setBanner] = useState<BannerState | null>(null);
  const translateY = useRef(new Animated.Value(DISMISS_TRANSLATE)).current;
  const dismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pathnameRef = useRef(pathname);
  pathnameRef.current = pathname;

  const clearDismissTimer = useCallback(() => {
    if (dismissTimer.current) {
      clearTimeout(dismissTimer.current);
      dismissTimer.current = null;
    }
  }, []);

  const dismiss = useCallback(() => {
    clearDismissTimer();
    Animated.timing(translateY, {
      toValue: DISMISS_TRANSLATE,
      duration: SLIDE_DURATION,
      easing: Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start(() => {
      setBanner(null);
    });
  }, [clearDismissTimer, translateY]);

  // Reminders surface through two paths when the app is foregrounded: an
  // in-process timer (`reminderNotifications.startForegroundReminderWatcher`)
  // and the OS notification listener. Both can fire for the same reminder, so
  // we dedupe identical payloads that arrive within a short window.
  const recentSig = useRef<{ sig: string; t: number } | null>(null);

  useEffect(() => {
    const handlePush = (payload: ForegroundPushPayload) => {
      if (isOnTargetScreen(pathnameRef.current, payload.link)) return;
      const title = payload.title?.trim() || "Round House";
      const body = payload.body?.trim() || "";
      if (!title && !body) return;
      const link = payload.link;
      const linkSig =
        (link?.reminderId ??
          (link?.workOrderId !== undefined ? `wo:${link.workOrderId}` : "")) ||
        (link?.propertyId !== undefined ? `prop:${link.propertyId}` : "") ||
        link?.type ||
        "";
      const sig = `${title}|${body}|${linkSig}`;
      const now = Date.now();
      if (
        recentSig.current &&
        recentSig.current.sig === sig &&
        now - recentSig.current.t < 5000
      ) {
        return;
      }
      recentSig.current = { sig, t: now };
      setBanner({
        title,
        body,
        link,
      });
    };
    return subscribeToForegroundPush(handlePush);
  }, []);

  useEffect(() => {
    if (!banner) return;
    translateY.setValue(DISMISS_TRANSLATE);
    Animated.timing(translateY, {
      toValue: 0,
      duration: SLIDE_DURATION,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
    clearDismissTimer();
    dismissTimer.current = setTimeout(() => {
      dismiss();
    }, AUTO_DISMISS_MS);
    return clearDismissTimer;
  }, [banner, clearDismissTimer, dismiss, translateY]);

  // Hide if user navigates onto the target screen while banner is visible.
  useEffect(() => {
    if (banner && isOnTargetScreen(pathname, banner.link)) {
      dismiss();
    }
  }, [pathname, banner, dismiss]);

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gesture) => Math.abs(gesture.dy) > 4,
      onPanResponderGrant: () => {
        clearDismissTimer();
      },
      onPanResponderMove: (_, gesture) => {
        if (gesture.dy < 0) {
          translateY.setValue(gesture.dy);
        }
      },
      onPanResponderRelease: (_, gesture) => {
        if (gesture.dy < -40) {
          dismiss();
        } else {
          Animated.timing(translateY, {
            toValue: 0,
            duration: 150,
            useNativeDriver: true,
          }).start();
          dismissTimer.current = setTimeout(dismiss, AUTO_DISMISS_MS);
        }
      },
    }),
  ).current;

  if (!banner) return null;

  const handlePress = () => {
    const link = banner.link;
    dismiss();
    if (link) onPress(link);
  };

  return (
    <Animated.View
      pointerEvents="box-none"
      style={[
        styles.container,
        {
          paddingTop: insets.top + 6,
          transform: [{ translateY }],
        },
      ]}
    >
      <View
        {...panResponder.panHandlers}
        style={[
          styles.card,
          {
            backgroundColor: colors.card,
            borderColor: colors.border,
            shadowColor: colors.foreground,
          },
        ]}
      >
        <View style={styles.row}>
          <Pressable
            style={styles.pressable}
            onPress={handlePress}
            android_ripple={{ color: colors.muted }}
          >
            <View style={[styles.iconWrap, { backgroundColor: colors.scoreBackground }]}>
              <Feather name="bell" size={18} color={colors.primary} />
            </View>
            <View style={styles.textWrap}>
              <Text
                style={[styles.title, { color: colors.foreground }]}
                numberOfLines={1}
              >
                {banner.title}
              </Text>
              {banner.body ? (
                <Text
                  style={[styles.body, { color: colors.mutedForeground }]}
                  numberOfLines={2}
                >
                  {banner.body}
                </Text>
              ) : null}
            </View>
          </Pressable>
          <Pressable
            onPress={dismiss}
            hitSlop={10}
            style={styles.closeBtn}
            accessibilityLabel="Dismiss notification"
          >
            <Feather name="x" size={16} color={colors.mutedForeground} />
          </Pressable>
        </View>
        <View style={[styles.handle, { backgroundColor: colors.border }]} />
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 12,
    zIndex: 9999,
    elevation: 12,
  },
  card: {
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
    ...Platform.select({
      ios: {
        shadowOpacity: 0.18,
        shadowRadius: 12,
        shadowOffset: { width: 0, height: 6 },
      },
      android: {
        elevation: 8,
      },
      default: {},
    }),
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingRight: 8,
  },
  pressable: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    paddingHorizontal: 12,
    gap: 12,
  },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
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
  handle: {
    alignSelf: "center",
    width: 36,
    height: 3,
    borderRadius: 2,
    marginBottom: 6,
    opacity: 0.6,
  },
});
