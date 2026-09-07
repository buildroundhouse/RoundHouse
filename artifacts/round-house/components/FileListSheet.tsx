import React from "react";
import {
  Linking,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { resolveStorageUrl } from "@/lib/uploads";
import type { AttachmentItem } from "@/components/AttachmentList";

export function formatFileSize(bytes?: number): string | null {
  if (typeof bytes !== "number" || !Number.isFinite(bytes) || bytes <= 0) return null;
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(kb < 10 ? 1 : 0)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(mb < 10 ? 1 : 0)} MB`;
  const gb = mb / 1024;
  return `${gb.toFixed(gb < 10 ? 1 : 0)} GB`;
}

export function FileListSheet({
  files,
  onClose,
  bottomInset = 0,
}: {
  files: AttachmentItem[] | null;
  onClose: () => void;
  bottomInset?: number;
}) {
  const colors = useColors();
  const open = (att: AttachmentItem) => {
    const url = resolveStorageUrl(att.path);
    if (!url) return;
    if (Platform.OS === "web") {
      window.open(url, "_blank");
    } else {
      Linking.openURL(url).catch(() => {});
    }
    onClose();
  };
  return (
    <Modal
      visible={files !== null}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable style={sheetStyles.backdrop} onPress={onClose}>
        <Pressable
          style={[
            sheetStyles.sheet,
            {
              backgroundColor: colors.card,
              paddingBottom: 12 + bottomInset,
              borderColor: colors.border,
            },
          ]}
          onPress={() => {}}
        >
          <View style={sheetStyles.handle} />
          <View style={sheetStyles.headerRow}>
            <Text style={[sheetStyles.title, { color: colors.foreground }]}>
              {files?.length ?? 0} attached {files?.length === 1 ? "file" : "files"}
            </Text>
            <TouchableOpacity onPress={onClose} hitSlop={10}>
              <Feather name="x" size={20} color={colors.mutedForeground} />
            </TouchableOpacity>
          </View>
          {(files ?? []).map((att, i) => {
            const sizeLabel = formatFileSize(att.size);
            return (
              <TouchableOpacity
                key={`${att.path}-${i}`}
                onPress={() => open(att)}
                style={[
                  sheetStyles.row,
                  i < (files?.length ?? 0) - 1 && {
                    borderBottomWidth: StyleSheet.hairlineWidth,
                    borderBottomColor: colors.border,
                  },
                ]}
                accessibilityRole="button"
                accessibilityLabel={`Open ${att.name || "attachment"}`}
              >
                <View
                  style={[
                    sheetStyles.iconWrap,
                    { backgroundColor: colors.muted, borderColor: colors.border },
                  ]}
                >
                  <Feather name="paperclip" size={16} color={colors.foreground} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text
                    style={[sheetStyles.name, { color: colors.foreground }]}
                    numberOfLines={1}
                  >
                    {att.name || "Attachment"}
                  </Text>
                  {sizeLabel ? (
                    <Text style={[sheetStyles.meta, { color: colors.mutedForeground }]}>
                      {sizeLabel}
                    </Text>
                  ) : null}
                </View>
                <Feather name="external-link" size={16} color={colors.mutedForeground} />
              </TouchableOpacity>
            );
          })}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const sheetStyles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "flex-end",
  },
  sheet: {
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingHorizontal: 16,
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  handle: {
    alignSelf: "center",
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: "rgba(127,127,127,0.4)",
    marginBottom: 8,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 8,
  },
  title: { fontSize: 14, fontFamily: "Inter_700Bold" },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 12,
  },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: StyleSheet.hairlineWidth,
  },
  name: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  meta: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
});
