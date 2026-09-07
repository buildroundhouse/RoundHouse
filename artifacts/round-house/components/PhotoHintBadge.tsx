import React, { useEffect, useState } from "react";
import { ActivityIndicator, Image, Pressable, StyleSheet, Text } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";

type Colors = ReturnType<typeof useColors>;

export function PhotoHintBadge({
  onPress,
  colors,
  count,
  thumbnailUrl,
  loading,
  accessibilityLabel,
}: {
  onPress: () => void;
  colors: Colors;
  count: number;
  thumbnailUrl: string | null;
  loading?: boolean;
  accessibilityLabel: string;
}) {
  const [thumbFailed, setThumbFailed] = useState(false);
  useEffect(() => {
    setThumbFailed(false);
  }, [thumbnailUrl]);
  const showThumb = !!thumbnailUrl && !thumbFailed && !loading;
  return (
    <Pressable
      onPress={onPress}
      disabled={loading}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => [
        showThumb ? styles.photoHintThumbBadge : styles.photoHintBadge,
        {
          borderColor: colors.border,
          backgroundColor: colors.muted,
          opacity: pressed || loading ? 0.6 : 1,
        },
      ]}
    >
      {loading ? (
        <ActivityIndicator size="small" color={colors.mutedForeground} />
      ) : showThumb ? (
        <Image
          source={{ uri: thumbnailUrl! }}
          style={styles.photoHintThumb}
          onError={() => setThumbFailed(true)}
          accessibilityIgnoresInvertColors
        />
      ) : (
        <Feather name="camera" size={10} color={colors.mutedForeground} />
      )}
      {count > 1 && !loading && (
        <Text
          style={[
            styles.photoHintText,
            showThumb ? styles.photoHintTextOnThumb : null,
            { color: colors.mutedForeground },
          ]}
        >
          {count}
        </Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  photoHintBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  photoHintThumbBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingLeft: 2,
    paddingRight: 6,
    paddingVertical: 2,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  photoHintThumb: {
    width: 20,
    height: 20,
    borderRadius: 6,
    resizeMode: "cover",
  },
  photoHintText: {
    fontSize: 10,
    fontFamily: "Inter_600SemiBold",
  },
  photoHintTextOnThumb: {
    fontSize: 11,
    fontFamily: "Inter_700Bold",
  },
});
