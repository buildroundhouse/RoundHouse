import React from "react";
import {
  Image,
  ImageBackground,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { resolveStorageUrl } from "@/lib/uploads";
import { DemoBadge } from "@/components/DemoBadge";

type Props = {
  companyName: string | null;
  slogan: string | null;
  companyLogoUrl: string | null;
  headerImageUrl: string | null;
  avatarUrl: string | null;
  fallbackName: string;
  username?: string | null;
  rankBadge?: React.ReactNode;
  onEdit?: () => void;
  onFindPeople?: () => void;
  onHelp?: () => void;
  onSettings?: () => void;
  /** Cache-bust token (e.g. profile.updatedAt) so a freshly-saved photo
   *  replaces any stale cached <Image> entry for the same URL. */
  mediaVersion?: string | number | Date | null;
  /** Optional overlay rendered absolutely positioned at the bottom-right of
   *  the banner (next to the avatar). Used for the Share Round House pill. */
  bannerOverlay?: React.ReactNode;
  /** Optional compact element rendered to the right of the company name on
   *  the same row, vertically centered. Used for the Share Round House pill. */
  companyNameTrailing?: React.ReactNode;
  /** Optional trailing element rendered at the right end of the
   *  identity meta row (handle + rank). Used for the People I've Invited
   *  shortcut chip. Must be a compact element so it doesn't crowd long
   *  company names — `flexShrink: 0` is enforced via the slot wrapper. */
  identityMetaTrailing?: React.ReactNode;
  /** When true, renders a "DEMO" pill next to the company name so any
   *  viewer can immediately tell this avatar isn't real production data
   *  before interacting with it. Behavior and permissions are unchanged. */
  isDemo?: boolean;
  /** Optional handler invoked when the user taps their own avatar.
   *  When provided, the avatar circle becomes a button that opens a
   *  self-preview of the profile (e.g. `FullProfileModal`). When
   *  omitted, the avatar renders as a plain image with no press
   *  affordance — preserving existing call sites that don't want a
   *  tap target. */
  onAvatarPress?: () => void;
};

const HERO_HEIGHT = 180;
const AVATAR_SIZE = 96;
const BRAND_ICON = 26;

export function IdentityHero({
  companyName,
  slogan,
  companyLogoUrl,
  headerImageUrl,
  avatarUrl,
  fallbackName,
  username,
  rankBadge,
  onEdit,
  onFindPeople,
  onHelp,
  onSettings,
  mediaVersion,
  bannerOverlay,
  companyNameTrailing,
  identityMetaTrailing,
  isDemo,
  onAvatarPress,
}: Props) {
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const topInset = Platform.OS === "web" ? 12 : insets.top + 4;

  const heroUri = resolveStorageUrl(headerImageUrl, mediaVersion);
  const logoUri = resolveStorageUrl(companyLogoUrl, mediaVersion);
  const avatarUri = resolveStorageUrl(avatarUrl, mediaVersion);

  const displayName = (companyName ?? "").trim() || fallbackName || "Your Company";
  const displaySlogan = (slogan ?? "").trim();
  const displayHandle = (username ?? "").trim();

  const Wrapper: React.ElementType = heroUri ? ImageBackground : View;
  const wrapperProps = heroUri
    ? { source: { uri: heroUri }, resizeMode: "cover" as const }
    : {};

  return (
    <View style={styles.outer}>
      {/* Spacer for status bar so the banner doesn't run under the notch. */}
      <View style={{ height: topInset }} />

      {/* Banner + avatar overlap. The wrapper around the banner is the
          positioning root for the avatar so we can anchor it with
          bottom: -AVATAR_SIZE/2 without depending on a brittle JS-time
          top calc that has to know about safe-area insets. */}
      <View style={styles.bannerStack}>
        <Wrapper {...wrapperProps} style={styles.hero}>
          <View pointerEvents="none" style={styles.shade} />

          {/* Action icons over banner top-right */}
          <View style={styles.actions}>
            {onFindPeople ? (
              <Pressable
                hitSlop={12}
                onPress={onFindPeople}
                style={styles.actionBtn}
                accessibilityLabel="Find people"
              >
                <Feather name="search" size={14} color="#fff" />
              </Pressable>
            ) : null}
            {onEdit ? (
              <Pressable
                hitSlop={12}
                onPress={onEdit}
                style={styles.actionBtn}
                accessibilityLabel="Edit company identity"
              >
                <Feather name="edit-2" size={14} color="#fff" />
              </Pressable>
            ) : null}
            {onHelp ? (
              <Pressable
                hitSlop={12}
                onPress={onHelp}
                style={styles.actionBtn}
                accessibilityLabel="About Roundhouse"
              >
                <Feather name="help-circle" size={14} color="#fff" />
              </Pressable>
            ) : null}
            {onSettings ? (
              <Pressable
                hitSlop={12}
                onPress={onSettings}
                style={styles.actionBtn}
                accessibilityLabel="Settings"
              >
                <Feather name="settings" size={14} color="#fff" />
              </Pressable>
            ) : null}
          </View>
        </Wrapper>

        {bannerOverlay ? <View style={styles.bannerOverlay}>{bannerOverlay}</View> : null}

        {onAvatarPress ? (
          <Pressable
            onPress={onAvatarPress}
            accessibilityRole="button"
            accessibilityLabel="View your profile preview"
            testID="identity-hero-avatar-button"
            hitSlop={6}
            style={({ pressed }) => [
              styles.avatarWrap,
              { borderColor: colors.background, opacity: pressed ? 0.85 : 1 },
            ]}
          >
            {avatarUri ? (
              <Image source={{ uri: avatarUri }} style={styles.avatarImg} />
            ) : (
              <View style={[styles.avatarFallback, { backgroundColor: colors.muted }]}>
                <Feather name="user" size={42} color={colors.mutedForeground} />
              </View>
            )}
          </Pressable>
        ) : (
          <View style={[styles.avatarWrap, { borderColor: colors.background }]}>
            {avatarUri ? (
              <Image source={{ uri: avatarUri }} style={styles.avatarImg} />
            ) : (
              <View style={[styles.avatarFallback, { backgroundColor: colors.muted }]}>
                <Feather name="user" size={42} color={colors.mutedForeground} />
              </View>
            )}
          </View>
        )}
      </View>

      {/* Company name on top; handle + rank on a second line beneath it. */}
      {displayName || displayHandle || rankBadge ? (
        <View style={styles.belowBanner}>
          {displayName ? (
            <View style={styles.companyNameRow}>
              <Text
                style={[styles.companyName, { color: colors.foreground }]}
                numberOfLines={1}
              >
                {displayName}
              </Text>
              {isDemo ? <DemoBadge size="md" /> : null}
              {companyNameTrailing ? (
                <View style={styles.companyNameTrailingSlot}>
                  {companyNameTrailing}
                </View>
              ) : null}
            </View>
          ) : null}
          {displayHandle || rankBadge ? (
            <View style={styles.metaRow}>
              {displayHandle ? (
                <Text
                  style={[styles.handle, { color: colors.mutedForeground }]}
                  numberOfLines={1}
                >
                  @{displayHandle}
                </Text>
              ) : null}
              {rankBadge ? <View style={styles.rankSlot}>{rankBadge}</View> : null}
              {identityMetaTrailing ? (
                <View style={styles.metaTrailingSlot}>{identityMetaTrailing}</View>
              ) : null}
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  outer: {
    position: "relative",
  },

  brandBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingBottom: 8,
    gap: 8,
  },
  brandIcon: {
    width: BRAND_ICON,
    height: BRAND_ICON,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  brandIconImg: { width: "100%", height: "100%" },
  brandName: {
    fontSize: 17,
    fontFamily: "Inter_700Bold",
    flexShrink: 0,
  },
  brandSlogan: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    flexShrink: 1,
  },

  hero: {
    width: "100%",
    height: HERO_HEIGHT,
    backgroundColor: "#1f242b",
    overflow: "hidden",
    position: "relative",
  },
  shade: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.18)",
  },
  actions: {
    position: "absolute",
    top: 12,
    right: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  actionBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: "rgba(0,0,0,0.45)",
    alignItems: "center",
    justifyContent: "center",
  },

  bannerStack: {
    position: "relative",
  },
  avatarWrap: {
    position: "absolute",
    left: 14,
    top: (HERO_HEIGHT - AVATAR_SIZE) / 2,
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2,
    borderWidth: 0,
    overflow: "hidden",
    zIndex: 2,
  },
  avatarImg: { width: "100%", height: "100%" },
  avatarFallback: { flex: 1, alignItems: "center", justifyContent: "center" },
  bannerOverlay: {
    position: "absolute",
    right: 14,
    bottom: -22,
    zIndex: 3,
  },

  belowBanner: {
    paddingTop: 8,
    paddingHorizontal: 14,
    paddingBottom: 8,
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
  },
  companyNameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  companyName: {
    fontSize: 17,
    fontFamily: "Inter_700Bold",
    flexShrink: 1,
  },
  companyNameTrailingSlot: {
    flexShrink: 0,
    marginLeft: "auto",
  },
  handle: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
  },
  rankSlot: {
    flexShrink: 0,
  },
  metaTrailingSlot: {
    flexShrink: 0,
    marginLeft: "auto",
  },
});
