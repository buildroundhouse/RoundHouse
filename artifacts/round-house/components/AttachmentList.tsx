import React from "react";
import { Image, Linking, Platform, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { resolveStorageUrl } from "@/lib/uploads";

export type AttachmentItem = {
  path: string;
  kind: "image" | "file";
  name?: string;
  contentType?: string;
  size?: number;
};

type Size = "sm" | "md";

export function AttachmentList({
  attachments,
  size = "md",
  onRemove,
  onImagePress,
  note,
  selectMode = false,
  selectedPaths,
  onToggleSelect,
}: {
  attachments: AttachmentItem[];
  size?: Size;
  onRemove?: (index: number) => void;
  onImagePress?: (att: AttachmentItem, index: number) => void;
  note?: string | null;
  /** When true, image thumbnails toggle selection instead of opening. */
  selectMode?: boolean;
  /** Paths of currently selected image attachments. */
  selectedPaths?: ReadonlySet<string>;
  /** Called when an image thumbnail is tapped in select mode. */
  onToggleSelect?: (att: AttachmentItem) => void;
}) {
  const colors = useColors();
  if (!attachments?.length) return null;

  const dim = size === "sm" ? 56 : 88;

  const openFile = (att: AttachmentItem) => {
    const url = resolveStorageUrl(att.path);
    if (!url) return;
    if (Platform.OS === "web") {
      window.open(url, "_blank");
    } else {
      Linking.openURL(url).catch(() => {});
    }
  };

  return (
    <View style={styles.row}>
      {attachments.map((att, idx) => {
        const url = resolveStorageUrl(att.path);
        if (att.kind === "image" && url) {
          const isSelectable = selectMode && !!onToggleSelect;
          const isSelected = isSelectable && !!selectedPaths?.has(att.path);
          return (
            <TouchableOpacity
              key={`${att.path}-${idx}`}
              onPress={() => {
                if (isSelectable) {
                  onToggleSelect?.(att);
                  return;
                }
                if (onImagePress) onImagePress(att, idx);
                else openFile(att);
              }}
              accessibilityRole={isSelectable ? "checkbox" : "button"}
              accessibilityState={isSelectable ? { checked: isSelected } : undefined}
              accessibilityLabel={
                isSelectable
                  ? isSelected
                    ? "Deselect this photo"
                    : "Select this photo"
                  : undefined
              }
              style={[
                styles.thumbWrap,
                { width: dim, height: dim, borderColor: colors.border },
                isSelected && { borderColor: colors.primary, borderWidth: 2 },
              ]}
            >
              <Image source={{ uri: url }} style={{ width: "100%", height: "100%" }} resizeMode="cover" />
              {note ? <NoteOverlay note={note} /> : null}
              {isSelectable && (
                <SelectOverlay selected={isSelected} colors={colors} />
              )}
              {onRemove && (
                <RemoveBtn onPress={() => onRemove(idx)} colors={colors} />
              )}
            </TouchableOpacity>
          );
        }
        return (
          <TouchableOpacity
            key={`${att.path}-${idx}`}
            onPress={() => openFile(att)}
            style={[styles.fileChip, { borderColor: colors.border, backgroundColor: colors.card }]}
          >
            <Feather name="paperclip" size={14} color={colors.foreground} />
            <Text style={[styles.fileText, { color: colors.foreground }]} numberOfLines={1}>
              {att.name || "Attachment"}
            </Text>
            {onRemove && <RemoveBtn onPress={() => onRemove(idx)} colors={colors} inline />}
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

export function PhotoPreview({
  path,
  size = 120,
  onRemove,
  note,
}: {
  path: string;
  size?: number;
  onRemove?: () => void;
  note?: string | null;
}) {
  const colors = useColors();
  const url = resolveStorageUrl(path);
  if (!url) return null;
  return (
    <View style={[styles.thumbWrap, { width: size, height: size, borderColor: colors.border }]}>
      <Image source={{ uri: url }} style={{ width: "100%", height: "100%" }} resizeMode="cover" />
      {note ? <NoteOverlay note={note} /> : null}
      {onRemove && <RemoveBtn onPress={onRemove} colors={colors} />}
    </View>
  );
}

function SelectOverlay({
  selected,
  colors,
}: {
  selected: boolean;
  colors: ReturnType<typeof useColors>;
}) {
  return (
    <>
      <View
        pointerEvents="none"
        style={[
          styles.selectScrim,
          selected && { backgroundColor: "rgba(47,111,237,0.18)" },
        ]}
      />
      <View
        pointerEvents="none"
        style={[
          styles.selectCheckbox,
          {
            borderColor: selected ? colors.primary : "rgba(255,255,255,0.95)",
            backgroundColor: selected ? colors.primary : "rgba(0,0,0,0.35)",
          },
        ]}
      >
        {selected && <Feather name="check" size={12} color="#fff" />}
      </View>
    </>
  );
}

function NoteOverlay({ note }: { note: string }) {
  const trimmed = note.trim();
  if (!trimmed) return null;
  return (
    <View style={styles.noteOverlay} pointerEvents="none" accessibilityLabel={trimmed}>
      <Text style={styles.noteOverlayText} numberOfLines={1}>
        {trimmed}
      </Text>
    </View>
  );
}

function RemoveBtn({
  onPress,
  colors,
  inline,
}: {
  onPress: () => void;
  colors: ReturnType<typeof useColors>;
  inline?: boolean;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      hitSlop={8}
      style={inline ? styles.removeInline : [styles.removeBtn, { backgroundColor: colors.background }]}
    >
      <Feather name="x" size={12} color={colors.foreground} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8 },
  thumbWrap: { borderRadius: 8, overflow: "hidden", borderWidth: 1, position: "relative" },
  selectScrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.18)",
  },
  selectCheckbox: {
    position: "absolute",
    top: 4,
    left: 4,
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
  },
  removeBtn: {
    position: "absolute",
    top: 2,
    right: 2,
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
  },
  removeInline: { marginLeft: 4 },
  noteOverlay: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 6,
    paddingVertical: 3,
    backgroundColor: "rgba(0,0,0,0.55)",
  },
  noteOverlayText: {
    color: "#fff",
    fontSize: 10,
    fontFamily: "Inter_500Medium",
  },
  fileChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    maxWidth: 220,
  },
  fileText: { fontSize: 12, fontFamily: "Inter_500Medium", flexShrink: 1 },
});
