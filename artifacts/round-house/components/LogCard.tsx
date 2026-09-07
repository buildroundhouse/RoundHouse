import React from "react";
import { Image, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { WorkLog } from "@/context/AppContext";

interface Props {
  log: WorkLog;
  propertyName?: string;
  showProperty?: boolean;
  onPress?: () => void;
}

function formatRelativeTime(isoString: string): string {
  const now = new Date();
  const date = new Date(isoString);
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function LogCard({ log, propertyName, showProperty = false, onPress }: Props) {
  const colors = useColors();

  return (
    <TouchableOpacity
      style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}
      onPress={onPress}
      activeOpacity={onPress ? 0.8 : 1}
    >
      <View style={styles.row}>
        {log.photoUri ? (
          <Image source={{ uri: log.photoUri }} style={styles.photo} />
        ) : (
          <View style={[styles.photoPlaceholder, { backgroundColor: colors.muted }]}>
            <Feather name="image" size={18} color={colors.mutedForeground} />
          </View>
        )}
        <View style={styles.content}>
          {showProperty && propertyName && (
            <Text style={[styles.propertyName, { color: colors.primary }]} numberOfLines={1}>
              {propertyName}
            </Text>
          )}
          <Text style={[styles.note, { color: colors.foreground }]} numberOfLines={3}>
            {log.note || "Work logged"}
          </Text>
          <View style={styles.meta}>
            <View style={styles.metaLeft}>
              <Feather name="clock" size={11} color={colors.mutedForeground} />
              <Text style={[styles.time, { color: colors.mutedForeground }]}>
                {formatRelativeTime(log.timestamp)}
              </Text>
              {log.isRealTime && (
                <>
                  <View style={[styles.dot, { backgroundColor: colors.mutedForeground }]} />
                  <View style={[styles.liveTag, { backgroundColor: colors.scoreBackground }]}>
                    <Text style={[styles.liveText, { color: colors.primary }]}>live</Text>
                  </View>
                </>
              )}
            </View>
            <View style={styles.scoreTag}>
              <Text style={[styles.scoreText, { color: colors.primary }]}>+{log.score}</Text>
            </View>
          </View>
        </View>
      </View>
      {log.viewed && (
        <View style={[styles.viewedBar, { backgroundColor: colors.muted }]}>
          <Feather name="eye" size={10} color={colors.mutedForeground} />
          <Text style={[styles.viewedText, { color: colors.mutedForeground }]}>Seen</Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 10,
    overflow: "hidden",
  },
  row: {
    flexDirection: "row",
    padding: 12,
    gap: 12,
  },
  photo: {
    width: 72,
    height: 72,
    borderRadius: 8,
    flexShrink: 0,
  },
  photoPlaceholder: {
    width: 72,
    height: 72,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  content: {
    flex: 1,
    gap: 4,
    justifyContent: "center",
  },
  propertyName: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  note: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    lineHeight: 20,
  },
  meta: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 4,
  },
  metaLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  time: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
  },
  dot: {
    width: 3,
    height: 3,
    borderRadius: 2,
  },
  liveTag: {
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 4,
  },
  liveText: {
    fontSize: 10,
    fontFamily: "Inter_600SemiBold",
  },
  scoreTag: {
    alignItems: "flex-end",
  },
  scoreText: {
    fontSize: 13,
    fontFamily: "Inter_700Bold",
  },
  viewedBar: {
    flexDirection: "row",
    gap: 4,
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  viewedText: {
    fontSize: 10,
    fontFamily: "Inter_400Regular",
  },
});
