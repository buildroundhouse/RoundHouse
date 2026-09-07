import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  AccessibilityInfo,
  Animated,
  BackHandler,
  Easing,
  PanResponder,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";

// Width reserved on the right edge of the screen for the home side-tab
// rail so it stays visible / tappable while a panel is open. The rail
// itself is 22px wide; the extra room gives the curved bookmark a soft
// gutter so it doesn't crowd the panel edge.
export const HOME_SIDE_RAIL_WIDTH = 50;

export type HomeSidePanelKey =
  | "logs"
  | "jobs"
  | "receipts"
  | "reminders"
  | "properties";

/**
 * Dimmed overlay that hosts a Home-screen side-tab panel. Provides:
 *  - a translucent scrim covering the area behind the panel (tap to close)
 *  - a panel sized to ~85% of the timeline area, anchored top-left so the
 *    side-tab rail on the right remains tappable
 *  - a panel header with the section title, optional headerRight slot
 *    (used by Reminders for its "+" affordance), and a close (X) button
 *  - scale + fade open/close animation originating from the tapped tab's
 *    vertical position
 *  - Android hardware back button + horizontal swipe-right to dismiss
 */
export function HomeSidePanelOverlay({
  panelKey,
  originY,
  topOffset,
  title,
  headerRight,
  onClose,
  children,
}: {
  panelKey: HomeSidePanelKey | null;
  originY: number;
  topOffset: number;
  title: string;
  headerRight?: React.ReactNode;
  onClose: () => void;
  children?: React.ReactNode;
}) {
  const colors = useColors();
  const { width, height } = useWindowDimensions();
  const open = panelKey != null;
  const [mounted, setMounted] = useState(open);

  useEffect(() => {
    if (open) setMounted(true);
  }, [open]);

  const scrim = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(0.85)).current;
  const fade = useRef(new Animated.Value(0)).current;
  const dragX = useRef(new Animated.Value(0)).current;

  const lastTitleRef = useRef<string>("");
  useEffect(() => {
    if (open) {
      lastTitleRef.current = title;
      AccessibilityInfo.announceForAccessibility?.(`${title} opened`);
      dragX.setValue(0);
      Animated.parallel([
        Animated.timing(scrim, {
          toValue: 1,
          duration: 180,
          useNativeDriver: true,
          easing: Easing.out(Easing.quad),
        }),
        Animated.spring(scale, {
          toValue: 1,
          friction: 8,
          tension: 90,
          useNativeDriver: true,
        }),
        Animated.timing(fade, {
          toValue: 1,
          duration: 180,
          useNativeDriver: true,
        }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(scrim, {
          toValue: 0,
          duration: 140,
          useNativeDriver: true,
        }),
        Animated.timing(scale, {
          toValue: 0.85,
          duration: 140,
          useNativeDriver: true,
        }),
        Animated.timing(fade, {
          toValue: 0,
          duration: 140,
          useNativeDriver: true,
        }),
      ]).start(({ finished }) => {
        if (finished) setMounted(false);
      });
      const closingTitle = lastTitleRef.current;
      if (closingTitle) {
        AccessibilityInfo.announceForAccessibility?.(`${closingTitle} closed`);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, panelKey]);

  // Hardware back button (Android) closes the panel.
  useEffect(() => {
    if (!open || Platform.OS !== "android") return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      onClose();
      return true;
    });
    return () => sub.remove();
  }, [open, onClose]);

  // Horizontal swipe (rightward) on the panel dismisses it.
  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_evt, g) =>
          Math.abs(g.dx) > 12 && Math.abs(g.dx) > Math.abs(g.dy),
        onPanResponderMove: (_evt, g) => {
          if (g.dx > 0) dragX.setValue(g.dx);
        },
        onPanResponderRelease: (_evt, g) => {
          if (g.dx > 80 || g.vx > 0.5) {
            Animated.timing(dragX, {
              toValue: width,
              duration: 160,
              useNativeDriver: true,
            }).start(() => {
              dragX.setValue(0);
              onClose();
            });
          } else {
            Animated.spring(dragX, {
              toValue: 0,
              useNativeDriver: true,
              friction: 8,
            }).start();
          }
        },
        onPanResponderTerminate: () => {
          Animated.spring(dragX, {
            toValue: 0,
            useNativeDriver: true,
            friction: 8,
          }).start();
        },
      }),
    [dragX, onClose, width],
  );

  if (!open && !mounted) return null;

  const panelWidth = Math.max(0, width - HOME_SIDE_RAIL_WIDTH);
  const panelHeight = Math.max(0, height - topOffset);

  // Anchor scale to the tapped tab's vertical position. We approximate a
  // CSS-like transform-origin by translating before & after the scale so
  // the visual origin sits at originY (relative to the panel's top edge).
  const originRelY = Math.max(0, Math.min(panelHeight, originY - topOffset));
  const originAnchorY = panelHeight / 2 - originRelY;

  return (
    <View pointerEvents="box-none" style={StyleSheet.absoluteFillObject}>
      {/* Scrim — visually dims the entire screen but its tap target stops
          short of the right rail so the side-tab stack stays tappable for
          swapping panels or re-tapping the active tab to close. */}
      <Animated.View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFillObject,
          { backgroundColor: "rgba(0,0,0,0.45)", opacity: scrim },
        ]}
      />
      <Pressable
        accessibilityLabel="Close panel"
        onPress={onClose}
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          bottom: 0,
          width: Math.max(0, width - HOME_SIDE_RAIL_WIDTH),
        }}
      />

      {/* Panel — left-anchored, leaves the side-tab rail visible. */}
      <Animated.View
        accessibilityViewIsModal
        importantForAccessibility="yes"
        onAccessibilityEscape={onClose}
        {...panResponder.panHandlers}
        style={{
          position: "absolute",
          top: topOffset,
          left: 0,
          width: panelWidth,
          height: panelHeight,
          backgroundColor: colors.background,
          borderTopRightRadius: 18,
          borderBottomRightRadius: 18,
          overflow: "hidden",
          shadowColor: "#000",
          shadowOpacity: 0.25,
          shadowRadius: 14,
          shadowOffset: { width: 0, height: 6 },
          elevation: 12,
          opacity: fade,
          transform: [
            { translateX: dragX },
            { translateY: originAnchorY },
            { scale },
            { translateY: Animated.multiply(originAnchorY, -1) },
          ],
        }}
      >
        <View
          style={[
            styles.panelHeader,
            { borderBottomColor: colors.border, backgroundColor: colors.background },
          ]}
        >
          <Text
            style={[styles.panelTitle, { color: colors.foreground }]}
            numberOfLines={1}
            accessibilityRole="header"
          >
            {title}
          </Text>
          <View style={styles.panelHeaderRight}>
            {headerRight}
            <Pressable
              onPress={onClose}
              hitSlop={10}
              accessibilityLabel="Close panel"
              style={({ pressed }) => [styles.closeBtn, { opacity: pressed ? 0.6 : 1 }]}
            >
              <Feather name="x" size={20} color={colors.foreground} />
            </Pressable>
          </View>
        </View>
        <View style={{ flex: 1 }}>{children}</View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  panelHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  panelTitle: {
    fontSize: 16,
    fontFamily: "Inter_700Bold",
    flex: 1,
    minWidth: 0,
  },
  panelHeaderRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  closeBtn: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 16,
  },
});
