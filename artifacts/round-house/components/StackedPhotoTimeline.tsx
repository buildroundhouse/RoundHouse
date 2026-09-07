import React, { useMemo } from "react";
import {
  ActivityIndicator,
  Image,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useColors } from "@/hooks/useColors";
import { resolveStorageUrl } from "@/lib/uploads";
import {
  useGetUserSuccessStories,
  getGetUserSuccessStoriesQueryKey,
  type ProUserSuccessStory,
} from "@workspace/api-client-react";

interface Props {
  visible: boolean;
  clerkId: string | null;
  proName: string | null;
  /** When provided, level-1 view filtered to this service. When null, level-2 view (all stories). */
  service: string | null;
  /** Called when user taps the back/minimize affordance from level 1 — should drop to level 2. */
  onZoomOut: () => void;
  /** Called when user closes from level 2 (or via close button) — should return to profile. */
  onClose: () => void;
}

export function StackedPhotoTimeline({
  visible,
  clerkId,
  proName,
  service,
  onZoomOut,
  onClose,
}: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const params = service ? { service } : undefined;
  const queryKey = clerkId
    ? getGetUserSuccessStoriesQueryKey(clerkId, params)
    : ["userSuccessStories", "none"];
  const { data, isFetching } = useGetUserSuccessStories(clerkId ?? "", params, {
    query: { enabled: visible && !!clerkId, queryKey },
  });

  const stories: ProUserSuccessStory[] = useMemo(() => data?.stories ?? [], [data?.stories]);

  // Header label: "<Pro> · <Service> stories" at level 1, "<Pro> · All stories" at level 2.
  const scopeLabel = service ? `${service} stories` : "All stories";
  const headerTitle = proName ? `${proName} · ${scopeLabel}` : scopeLabel;

  // Minimize behavior: from level 1 → drop the service filter (zoom out to all);
  // from level 2 → fully close back to profile.
  const handleMinimize = service ? onZoomOut : onClose;

  function handleStoryPress(story: ProUserSuccessStory) {
    if (story.propertyId == null) return;
    onClose();
    router.push(
      `/property/${story.propertyId}?focusLogId=${story.logId}` as never,
    );
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={handleMinimize}>
      <View style={[styles.root, { backgroundColor: colors.background }]}>
        <View
          style={[
            styles.header,
            {
              borderBottomColor: colors.border,
              paddingTop: Platform.OS === "web" ? 24 : insets.top + 8,
            },
          ]}
        >
          <Pressable
            onPress={handleMinimize}
            hitSlop={20}
            style={{ padding: 8 }}
            accessibilityRole="button"
            accessibilityLabel={service ? "Zoom out to all stories" : "Back to profile"}
          >
            <Feather
              name={service ? "minimize-2" : "chevron-left"}
              size={20}
              color={colors.foreground}
            />
          </Pressable>
          <View style={styles.headerTitleWrap}>
            <Text
              style={[styles.headerTitle, { color: colors.foreground }]}
              numberOfLines={1}
            >
              {headerTitle}
            </Text>
            {service ? (
              <Text style={[styles.headerHint, { color: colors.mutedForeground }]} numberOfLines={1}>
                Tap minimize to see all of this pro's stories
              </Text>
            ) : null}
          </View>
          <Pressable
            onPress={onClose}
            hitSlop={20}
            style={{ padding: 8 }}
            accessibilityRole="button"
            accessibilityLabel="Close"
          >
            <Feather name="x" size={22} color={colors.foreground} />
          </Pressable>
        </View>

        {isFetching && stories.length === 0 ? (
          <View style={styles.center}>
            <ActivityIndicator color={colors.foreground} />
          </View>
        ) : stories.length === 0 ? (
          <View style={styles.center}>
            <Feather name="image" size={32} color={colors.mutedForeground} />
            <Text style={[styles.emptyTitle, { color: colors.foreground }]}>
              {service ? `No ${service} stories yet` : "No stories yet"}
            </Text>
            <Text style={[styles.emptyBody, { color: colors.mutedForeground }]}>
              {service
                ? "Once this pro publishes a success story tagged with this service, it will appear here."
                : "When this pro publishes their first success story it will land here."}
            </Text>
          </View>
        ) : (
          <ScrollView
            contentContainerStyle={[
              styles.scroll,
              { paddingBottom: insets.bottom + 24 },
            ]}
          >
            {stories.map((story) => (
              <StoryCard
                key={story.id}
                story={story}
                colors={colors}
                onPress={() => handleStoryPress(story)}
              />
            ))}
          </ScrollView>
        )}
      </View>
    </Modal>
  );
}

function StoryCard({
  story,
  colors,
  onPress,
}: {
  story: ProUserSuccessStory;
  colors: ReturnType<typeof useColors>;
  onPress: () => void;
}) {
  const photoUri = resolveStorageUrl(story.photoUrl ?? null, story.createdAt);
  const dateLabel = formatDate(story.createdAt);

  return (
    <Pressable
      onPress={onPress}
      disabled={story.propertyId == null}
      style={({ pressed }) => [
        styles.card,
        {
          backgroundColor: colors.card,
          borderColor: colors.border,
          opacity: pressed && story.propertyId != null ? 0.85 : 1,
        },
      ]}
    >
      <View style={[styles.photoFrame, { backgroundColor: colors.muted }]}>
        {photoUri ? (
          <Image source={{ uri: photoUri }} style={styles.photo} resizeMode="cover" />
        ) : (
          <View style={styles.photoPlaceholder}>
            <Feather name="image" size={28} color={colors.mutedForeground} />
          </View>
        )}
      </View>
      <View style={styles.cardBody}>
        <Text style={[styles.cardHeadline, { color: colors.foreground }]} numberOfLines={3}>
          {story.headline}
        </Text>
        <View style={styles.cardMetaRow}>
          {story.serviceTag ? (
            <View style={[styles.tagPill, { backgroundColor: colors.muted }]}>
              <Text style={[styles.tagText, { color: colors.mutedForeground }]} numberOfLines={1}>
                {story.serviceTag}
              </Text>
            </View>
          ) : null}
          <Text style={[styles.cardMeta, { color: colors.mutedForeground }]}>{dateLabel}</Text>
          {story.propertyName ? (
            <Text
              style={[styles.cardMeta, { color: colors.mutedForeground }]}
              numberOfLines={1}
            >
              · {story.propertyName}
            </Text>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  } catch {
    return "";
  }
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 4,
  },
  headerTitleWrap: { flex: 1, alignItems: "center", paddingHorizontal: 4 },
  headerTitle: { fontSize: 15, fontFamily: "Inter_700Bold" },
  headerHint: { fontSize: 11, fontFamily: "Inter_500Medium", marginTop: 2 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10, paddingHorizontal: 32 },
  emptyTitle: { fontSize: 15, fontFamily: "Inter_700Bold", marginTop: 8 },
  emptyBody: { fontSize: 13, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 19 },
  scroll: { padding: 16, gap: 12 },
  card: {
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
    marginBottom: 12,
  },
  photoFrame: { width: "100%", aspectRatio: 4 / 3 },
  photo: { width: "100%", height: "100%" },
  photoPlaceholder: { flex: 1, alignItems: "center", justifyContent: "center" },
  cardBody: { paddingHorizontal: 14, paddingVertical: 12, gap: 6 },
  cardHeadline: { fontSize: 14, fontFamily: "Inter_600SemiBold", lineHeight: 19 },
  cardMetaRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8 },
  tagPill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  tagText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  cardMeta: { fontSize: 12, fontFamily: "Inter_500Medium" },
});
