import React, { useMemo } from "react";
import { Image, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useColors } from "@/hooks/useColors";
import { useProfile } from "@/lib/profile";
import { resolveStorageUrl } from "@/lib/uploads";
import { MODE_LABELS } from "@/lib/intake-schemas";
import { OutwardAccountSwitcher } from "@/components/OutwardAccountSwitcher";
import { DemoBadge } from "@/components/DemoBadge";
import { useListNotifications } from "@workspace/api-client-react";

export function useActiveAccountAvatarUrl(): string | null {
  const { profile, activeOutwardAccount } = useProfile();
  return useMemo(() => {
    const a = activeOutwardAccount;
    const candidate =
      a?.avatarUrl?.trim() ||
      a?.bannerUrl?.trim() ||
      profile?.avatarUrl ||
      null;
    return resolveStorageUrl(candidate);
  }, [activeOutwardAccount, profile?.avatarUrl]);
}

export function useActiveAccountName(): string {
  const { activeOutwardAccount } = useProfile();
  return useMemo(() => {
    const a = activeOutwardAccount;
    if (!a) return "Account";
    return (
      a.title?.trim() ||
      a.displayName?.trim() ||
      a.companyName?.trim() ||
      ((MODE_LABELS as Record<string, string>)[a.kind] ?? "Account")
    );
  }, [activeOutwardAccount]);
}

/**
 * True iff the active avatar's owner is a demo profile from the admin
 * Wardrobe. The flag is computed server-side and rides on every
 * outward_account in the API response, so any UI surface can decide
 * whether to render a "DEMO" badge without extra fetches.
 */
export function useActiveAccountIsDemo(): boolean {
  const { activeOutwardAccount } = useProfile();
  return !!activeOutwardAccount?.isDemo;
}

/**
 * Top-bar identity cluster used across tab headers: avatar + active account
 * name + compact "Switch / Add Account" trigger. Mirrors the Timeline top bar so
 * the active account context is visible (and switchable) on every tab.
 */
export function TopBarAccountIdentity({
  avatarSize = 32,
  style,
  showInbox = true,
}: {
  avatarSize?: number;
  style?: StyleProp<ViewStyle>;
  showInbox?: boolean;
}) {
  const colors = useColors();
  const accountName = useActiveAccountName();
  const isDemo = useActiveAccountIsDemo();
  return (
    <View style={[identityStyles.row, style]}>
      <TopBarAvatar size={avatarSize} />
      <View style={identityStyles.textWrap}>
        <Text
          style={[identityStyles.name, { color: colors.foreground }]}
          numberOfLines={1}
          ellipsizeMode="tail"
        >
          {accountName}
        </Text>
        {isDemo ? <DemoBadge size="sm" /> : null}
        <OutwardAccountSwitcher variant="headerButton" />
      </View>
      {showInbox ? <InboxButton /> : null}
    </View>
  );
}

/**
 * Personal inbox entry point. The inbox follows the human across every
 * outward account / avatar and across every screen, so this button must be
 * available wherever the top-bar identity cluster appears. We reuse the
 * `["/api/notifications"]` query key the bottom-tab badge uses so the unread
 * count stays in lockstep without an extra request.
 */
export function InboxButton({ style }: { style?: StyleProp<ViewStyle> }) {
  const colors = useColors();
  const router = useRouter();
  const { data: notifications } = useListNotifications(undefined, {
    query: {
      queryKey: ["/api/notifications"],
      refetchInterval: 60_000,
      refetchOnWindowFocus: true,
    },
  });
  const unread = notifications?.unreadCount ?? 0;
  const badgeText = unread > 99 ? "99+" : String(unread);
  return (
    <Pressable
      onPress={() => router.push("/(tabs)/notifications" as never)}
      accessibilityLabel={unread > 0 ? `Inbox, ${unread} unread` : "Inbox"}
      hitSlop={10}
      style={[
        inboxStyles.btn,
        { borderColor: colors.border, backgroundColor: colors.card },
        style,
      ]}
    >
      <Feather name="mail" size={16} color={colors.foreground} />
      {unread > 0 ? (
        <View style={inboxStyles.badge}>
          <Text style={inboxStyles.badgeText} numberOfLines={1}>
            {badgeText}
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
}

const inboxStyles = StyleSheet.create({
  btn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  badge: {
    position: "absolute",
    top: -4,
    right: -4,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 5,
    backgroundColor: "#E11D2E",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.5,
    borderColor: "#fff",
  },
  badgeText: {
    color: "#fff",
    fontSize: 10,
    fontFamily: "Inter_700Bold",
    lineHeight: 12,
  },
});

const identityStyles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    flex: 1,
    minWidth: 0,
  },
  textWrap: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  name: {
    fontSize: 15,
    fontFamily: "Inter_700Bold",
    flexShrink: 1,
  },
});

export function TopBarAvatar({
  size = 32,
  onPress,
  style,
}: {
  size?: number;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  const colors = useColors();
  const router = useRouter();
  const avatarUrl = useActiveAccountAvatarUrl();
  const handlePress = onPress ?? (() => router.push("/(tabs)/profile" as never));

  const containerStyle = [
    styles.avatar,
    {
      width: size,
      height: size,
      borderRadius: size / 2,
      borderColor: colors.border,
      backgroundColor: colors.muted,
    },
    style,
  ];

  const inner = avatarUrl ? (
    <Image source={{ uri: avatarUrl }} style={styles.avatarImg} />
  ) : null;

  return (
    <Pressable
      onPress={handlePress}
      accessibilityLabel="Open profile"
      hitSlop={8}
      style={containerStyle}
    >
      {inner}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  avatar: {
    borderWidth: 1,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarImg: { width: "100%", height: "100%" },
});
