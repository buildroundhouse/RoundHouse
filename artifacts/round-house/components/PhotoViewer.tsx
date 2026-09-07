import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  FlatList,
  Image,
  Modal,
  Platform,
  Pressable,
  StatusBar,
  StyleSheet,
  Text,
  View,
  type ListRenderItemInfo,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as MediaLibrary from "expo-media-library";
import * as Sharing from "expo-sharing";

import {
  SHARE_PROMPT_LAST_NOTE_KEY,
  SHARE_PROMPT_SKIP_KEY,
  extractCustomNote,
} from "@/lib/sharePromptPref";
import {
  buildDefaultShareMessage,
  cleanupCacheFile,
  describeShareResult,
  downloadOnWeb,
  downloadToCache,
  saveToCameraRoll,
  shareAllOnNative,
  shareAllOnWeb,
  SharePromptModal,
  type PhotoShareContext,
  type ShareResult,
} from "@/lib/photoBatch";

export type { PhotoShareContext } from "@/lib/photoBatch";

import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { confirm } from "../lib/confirm";

export type PhotoViewerItem = {
  url: string;
  addedAt?: string;
  phase?: "created" | "in_progress" | "complete";
  addedByName?: string;
  logId?: number;
  logNote?: string;
  workOrderId?: number;
  storagePath?: string;
  canDelete?: boolean;
  evidenceId?: number;
};

const PHASE_LABEL: Record<NonNullable<PhotoViewerItem["phase"]>, string> = {
  created: "Created",
  in_progress: "In progress",
  complete: "Complete",
};

function formatDateTime(d?: string): string {
  if (!d) return "";
  const date = new Date(d);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function PhotoViewer({
  visible,
  photos,
  initialIndex,
  onClose,
  onJumpToLog,
  onJumpToWorkOrder,
  shareContext,
  onDeletePhoto,
}: {
  visible: boolean;
  photos: PhotoViewerItem[];
  initialIndex: number;
  onClose: () => void;
  onJumpToLog?: (logId: number) => void;
  onJumpToWorkOrder?: (workOrderId: number) => void;
  shareContext?: PhotoShareContext;
  onDeletePhoto?: (item: PhotoViewerItem, index: number) => void;
}) {
  const [index, setIndex] = useState(initialIndex);
  const [dims, setDims] = useState(() => Dimensions.get("window"));
  const [saving, setSaving] = useState(false);
  const [batchSaving, setBatchSaving] = useState(false);
  const [batchProgress, setBatchProgress] = useState({ done: 0, total: 0 });
  const [batchSharing, setBatchSharing] = useState(false);
  const [shareProgress, setShareProgress] = useState({ done: 0, total: 0 });
  const [sharePrompt, setSharePrompt] = useState<{
    message: string;
    defaultMessage: string;
    suggestion: string;
    skip: boolean;
    urls: string[];
  } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());

  const showToast = (msg: string) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(msg);
    toastTimer.current = setTimeout(() => setToast(null), 3000);
  };

  useEffect(() => {
    return () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  }, []);

  const validUrlCount = useMemo(
    () => photos.reduce((n, p) => (p.url ? n + 1 : n), 0),
    [photos]
  );
  const listRef = useRef<FlatList<PhotoViewerItem>>(null);

  const selectionKey = (item: PhotoViewerItem, i: number) =>
    `${item.url}-${i}`;
  const isSelected = (item: PhotoViewerItem, i: number) =>
    !!item.url && selectedKeys.has(selectionKey(item, i));
  const toggleSelected = (item: PhotoViewerItem, i: number) => {
    if (!item.url) return;
    const key = selectionKey(item, i);
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };
  const selectedUrls = useMemo(() => {
    const urls: string[] = [];
    photos.forEach((p, i) => {
      if (p.url && selectedKeys.has(selectionKey(p, i))) urls.push(p.url);
    });
    return urls;
  }, [photos, selectedKeys]);
  const selectedCount = selectedUrls.length;
  const exitSelectMode = () => {
    setSelectMode(false);
    setSelectedKeys(new Set());
  };

  // Reset selection whenever the viewer closes or the photo set changes,
  // so stale indices can't bleed into a different work order.
  useEffect(() => {
    if (!visible) {
      setSelectMode(false);
      setSelectedKeys(new Set());
    }
  }, [visible]);
  useEffect(() => {
    setSelectedKeys(new Set());
  }, [photos]);

  useEffect(() => {
    if (visible) {
      setIndex(initialIndex);
      // Defer to next frame so the FlatList is laid out before scrolling.
      const t = setTimeout(() => {
        listRef.current?.scrollToIndex({ index: initialIndex, animated: false });
      }, 0);
      return () => clearTimeout(t);
    }
  }, [visible, initialIndex]);

  useEffect(() => {
    const sub = Dimensions.addEventListener("change", ({ window }) => setDims(window));
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (!visible) return;
    if (photos.length === 0) return;
    if (index >= photos.length) {
      const next = Math.max(0, photos.length - 1);
      setIndex(next);
      const t = setTimeout(() => {
        listRef.current?.scrollToIndex({ index: next, animated: false });
      }, 0);
      return () => clearTimeout(t);
    }
  }, [photos.length, index, visible]);

  const current = photos[index];
  const onMomentumScrollEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const i = Math.round(e.nativeEvent.contentOffset.x / dims.width);
    if (i !== index && i >= 0 && i < photos.length) setIndex(i);
  };

  const keyExtractor = (item: PhotoViewerItem, i: number) => `${item.url}-${i}`;

  const onSave = async () => {
    if (!current || saving) return;
    const url = current.url;
    if (!url) return;
    setSaving(true);
    try {
      if (Platform.OS === "web") {
        await downloadOnWeb(url);
      } else {
        const outcome = await saveToCameraRoll(url);
        if (outcome === "saved") {
          Alert.alert("Saved", "Photo saved to your library.");
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not save photo.";
      if (Platform.OS === "web") {
        // eslint-disable-next-line no-alert
        if (typeof window !== "undefined") window.alert(message);
      } else {
        Alert.alert("Save failed", message);
      }
    } finally {
      setSaving(false);
    }
  };

  const onSaveAll = async () => {
    if (batchSaving || saving) return;
    if (selectMode && selectedUrls.length === 0) return;
    const urls = selectMode
      ? selectedUrls
      : photos.map((p) => p.url).filter((u): u is string => !!u);
    if (urls.length === 0) return;
    setBatchSaving(true);
    setBatchProgress({ done: 0, total: urls.length });
    try {
      if (Platform.OS === "web") {
        let saved = 0;
        let failed = 0;
        for (const url of urls) {
          try {
            await downloadOnWeb(url);
            saved += 1;
          } catch {
            failed += 1;
          }
          setBatchProgress({ done: saved + failed, total: urls.length });
          // Small gap so the browser doesn't drop rapid-fire downloads.
          await new Promise((r) => setTimeout(r, 250));
        }
        const msg =
          failed === 0
            ? `Started download for all ${saved} photo${saved === 1 ? "" : "s"}.`
            : `Downloaded ${saved} of ${urls.length} photos. ${failed} failed.`;
        showToast(msg);
      } else {
        const perm = await MediaLibrary.requestPermissionsAsync(true);
        if (!perm.granted) {
          throw new Error("Permission to save photos was denied.");
        }
        let saved = 0;
        let failed = 0;
        for (const url of urls) {
          try {
            const tmpUri = await downloadToCache(url);
            try {
              await MediaLibrary.saveToLibraryAsync(tmpUri);
              saved += 1;
            } finally {
              cleanupCacheFile(tmpUri);
            }
          } catch {
            failed += 1;
          }
          setBatchProgress({ done: saved + failed, total: urls.length });
        }
        const msg =
          failed === 0
            ? `Saved ${saved} photo${saved === 1 ? "" : "s"} to your library.`
            : `Saved ${saved} of ${urls.length} photos. ${failed} failed.`;
        Alert.alert(failed === 0 ? "Saved" : "Save complete", msg);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not save photos.";
      if (Platform.OS === "web") {
        showToast(message);
      } else {
        Alert.alert("Save failed", message);
      }
    } finally {
      setBatchSaving(false);
      setBatchProgress({ done: 0, total: 0 });
    }
  };

  const onShareAll = async () => {
    if (batchSharing || batchSaving || saving) return;
    if (selectMode && selectedUrls.length === 0) return;
    const urls = selectMode
      ? selectedUrls
      : photos.map((p) => p.url).filter((u): u is string => !!u);
    if (urls.length === 0) return;
    let skip = false;
    let suggestion = "";
    try {
      const [storedSkip, storedNote] = await Promise.all([
        AsyncStorage.getItem(SHARE_PROMPT_SKIP_KEY),
        AsyncStorage.getItem(SHARE_PROMPT_LAST_NOTE_KEY),
      ]);
      skip = storedSkip === "1";
      suggestion = (storedNote ?? "").trim();
    } catch {
      // ignore storage errors and fall back to showing the prompt
    }
    const defaultMessage = buildDefaultShareMessage(shareContext, urls.length);
    if (skip) {
      void runShare(urls, defaultMessage, defaultMessage);
      return;
    }
    setSharePrompt({
      message: defaultMessage,
      defaultMessage,
      suggestion,
      skip: false,
      urls,
    });
  };

  const runShare = async (
    urls: string[],
    message: string,
    defaultMessage: string
  ) => {
    const customNote = extractCustomNote(message, defaultMessage);
    try {
      if (customNote) {
        await AsyncStorage.setItem(SHARE_PROMPT_LAST_NOTE_KEY, customNote);
      } else {
        // User sent the bare default this time — drop any stale suggestion
        // so the chip reflects the most recent custom note, not an old one.
        await AsyncStorage.removeItem(SHARE_PROMPT_LAST_NOTE_KEY);
      }
    } catch {
      // best-effort persistence; suggestion will simply not appear next time
    }
    setBatchSharing(true);
    setShareProgress({ done: 0, total: urls.length });
    try {
      let result: ShareResult;
      if (Platform.OS === "web") {
        result = await shareAllOnWeb(urls, message, shareContext, (done) =>
          setShareProgress({ done, total: urls.length })
        );
      } else {
        result = await shareAllOnNative(urls, message, shareContext, (done) =>
          setShareProgress({ done, total: urls.length })
        );
      }
      const msg = describeShareResult(result);
      if (Platform.OS === "web") {
        showToast(msg);
      } else {
        Alert.alert(
          result.outcome === "cancelled" ? "Share cancelled" : "Share complete",
          msg
        );
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not share photos.";
      if (Platform.OS === "web") {
        showToast(message);
      } else {
        Alert.alert("Share failed", message);
      }
    } finally {
      setBatchSharing(false);
      setShareProgress({ done: 0, total: 0 });
    }
  };

  const renderItem = ({ item, index: i }: ListRenderItemInfo<PhotoViewerItem>) => (
    <View style={{ width: dims.width, height: dims.height }}>
      <ZoomableImage uri={item.url} width={dims.width} height={dims.height} />
      {selectMode && !!item.url && (
        <Pressable
          onPress={() => toggleSelected(item, i)}
          hitSlop={12}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: isSelected(item, i) }}
          accessibilityLabel={
            isSelected(item, i) ? "Deselect this photo" : "Select this photo"
          }
          style={({ pressed }) => [
            styles.selectChip,
            pressed && { opacity: 0.7 },
            { top: Platform.OS === "ios" ? 110 : 80 },
          ]}
        >
          <View
            style={[
              styles.selectChipBox,
              isSelected(item, i) && styles.selectChipBoxOn,
            ]}
          >
            {isSelected(item, i) && (
              <Feather name="check" size={16} color="#fff" />
            )}
          </View>
          <Text style={styles.selectChipLabel}>
            {isSelected(item, i) ? "Selected" : "Tap to select"}
          </Text>
        </Pressable>
      )}
    </View>
  );

  const caption = useMemo(() => {
    if (!current) return "";
    const parts: string[] = [];
    if (current.phase) parts.push(PHASE_LABEL[current.phase]);
    const t = formatDateTime(current.addedAt);
    if (t) parts.push(t);
    return parts.join(" • ");
  }, [current]);

  const subtitle = useMemo(() => {
    if (!current) return "";
    const name = current.addedByName?.trim();
    return name ? `Added by ${name}` : "";
  }, [current]);

  const logNote = useMemo(() => {
    const raw = current?.logNote?.trim();
    if (!raw) return "";
    const oneLine = raw.replace(/\s+/g, " ");
    return oneLine.length > 120 ? `${oneLine.slice(0, 117)}…` : oneLine;
  }, [current]);

  const canJumpToLog = !!(onJumpToLog && current?.logId != null);
  const handleJumpToLog = () => {
    if (!onJumpToLog || current?.logId == null) return;
    const id = current.logId;
    onClose();
    setTimeout(() => onJumpToLog(id), 0);
  };

  const canJumpToWorkOrder = !!(onJumpToWorkOrder && current?.workOrderId != null);
  const handleJumpToWorkOrder = () => {
    if (!onJumpToWorkOrder || current?.workOrderId == null) return;
    const id = current.workOrderId;
    onClose();
    setTimeout(() => onJumpToWorkOrder(id), 0);
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={styles.root}>
        {Platform.OS !== "web" && (
          <StatusBar barStyle="light-content" backgroundColor="#000" />
        )}
        <FlatList
          ref={listRef}
          data={photos}
          keyExtractor={keyExtractor}
          renderItem={renderItem}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          initialScrollIndex={initialIndex}
          getItemLayout={(_, i) => ({ length: dims.width, offset: dims.width * i, index: i })}
          onMomentumScrollEnd={onMomentumScrollEnd}
          extraData={dims.width}
          onScrollToIndexFailed={(info) => {
            setTimeout(() => {
              listRef.current?.scrollToOffset({
                offset: info.index * dims.width,
                animated: false,
              });
            }, 50);
          }}
        />

        <View style={[styles.topBar, { paddingTop: Platform.OS === "ios" ? 50 : 20 }]} pointerEvents="box-none">
          <Pressable onPress={onClose} hitSlop={12} style={styles.closeBtn}>
            <Feather name="x" size={22} color="#fff" />
          </Pressable>
          {selectMode ? (
            <Text style={styles.counter}>
              {selectedCount} selected
            </Text>
          ) : photos.length > 1 ? (
            <Text style={styles.counter}>
              {index + 1} / {photos.length}
            </Text>
          ) : (
            <View />
          )}
          <View style={styles.topActions}>
            {validUrlCount > 1 && (
              <>
                <Pressable
                  onPress={() => {
                    if (selectMode) exitSelectMode();
                    else setSelectMode(true);
                  }}
                  hitSlop={12}
                  disabled={batchSharing || batchSaving || saving}
                  style={({ pressed }) => [
                    styles.saveAllBtn,
                    selectMode && styles.saveAllBtnActive,
                    pressed && { opacity: 0.6 },
                  ]}
                  accessibilityLabel={
                    selectMode ? "Exit photo selection" : "Pick photos to share or save"
                  }
                >
                  <Feather
                    name={selectMode ? "x" : "check-square"}
                    size={16}
                    color="#fff"
                  />
                  <Text style={styles.saveAllLabel}>
                    {selectMode ? "Done" : "Select"}
                  </Text>
                </Pressable>
                <Pressable
                  onPress={onShareAll}
                  hitSlop={12}
                  disabled={
                    batchSharing ||
                    batchSaving ||
                    saving ||
                    (selectMode && selectedCount === 0)
                  }
                  style={({ pressed }) => [
                    styles.saveAllBtn,
                    (pressed || batchSharing) && { opacity: 0.6 },
                    selectMode && selectedCount === 0 && { opacity: 0.4 },
                  ]}
                  accessibilityLabel={
                    selectMode ? "Share selected photos" : "Share all photos"
                  }
                >
                  {batchSharing ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <Feather name="share-2" size={16} color="#fff" />
                  )}
                  <Text style={styles.saveAllLabel}>
                    {batchSharing
                      ? "Preparing…"
                      : selectMode
                      ? `Share (${selectedCount})`
                      : `Share all (${validUrlCount})`}
                  </Text>
                </Pressable>
                <Pressable
                  onPress={onSaveAll}
                  hitSlop={12}
                  disabled={
                    batchSaving ||
                    batchSharing ||
                    saving ||
                    (selectMode && selectedCount === 0)
                  }
                  style={({ pressed }) => [
                    styles.saveAllBtn,
                    (pressed || batchSaving) && { opacity: 0.6 },
                    selectMode && selectedCount === 0 && { opacity: 0.4 },
                  ]}
                  accessibilityLabel={
                    selectMode
                      ? Platform.OS === "web"
                        ? "Download selected photos"
                        : "Save selected photos"
                      : Platform.OS === "web"
                      ? "Download all photos"
                      : "Save all photos"
                  }
                >
                  {batchSaving ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <Feather name="download-cloud" size={16} color="#fff" />
                  )}
                  <Text style={styles.saveAllLabel}>
                    {batchSaving
                      ? Platform.OS === "web"
                        ? "Downloading…"
                        : "Saving…"
                      : selectMode
                      ? `${Platform.OS === "web" ? "Download" : "Save"} (${selectedCount})`
                      : `Save all (${validUrlCount})`}
                  </Text>
                </Pressable>
              </>
            )}
            <Pressable
              onPress={onSave}
              hitSlop={12}
              disabled={saving || batchSaving || !current}
              style={({ pressed }) => [
                styles.closeBtn,
                (pressed || saving) && { opacity: 0.6 },
              ]}
              accessibilityLabel={Platform.OS === "web" ? "Download photo" : "Save photo"}
            >
              {saving ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Feather name="download" size={20} color="#fff" />
              )}
            </Pressable>
            {!!onDeletePhoto && !!current?.canDelete && (
              <Pressable
                onPress={async () => {
                  if (!current) return;
                  const ok = await confirm({
                    title: "Delete photo",
                    message: "Remove this photo?",
                    confirmLabel: "Delete",
                    cancelLabel: "Cancel",
                    destructive: true,
                  });
                  if (ok) onDeletePhoto(current, index);
                }}
                hitSlop={12}
                disabled={saving || batchSaving || batchSharing}
                style={({ pressed }) => [
                  styles.closeBtn,
                  pressed && { opacity: 0.6 },
                ]}
                accessibilityLabel="Delete this photo"
              >
                <Feather name="trash-2" size={20} color="#fff" />
              </Pressable>
            )}
          </View>
        </View>

        {batchSaving && batchProgress.total > 0 && (
          <View style={styles.batchOverlay} pointerEvents="none">
            <View style={styles.batchCard}>
              <ActivityIndicator size="small" color="#fff" />
              <Text style={styles.batchText}>
                {Platform.OS === "web" ? "Downloading" : "Saving"}{" "}
                {batchProgress.done} of {batchProgress.total}
              </Text>
            </View>
          </View>
        )}

        {batchSharing && shareProgress.total > 0 && (
          <View style={styles.batchOverlay} pointerEvents="none">
            <View style={styles.batchCard}>
              <ActivityIndicator size="small" color="#fff" />
              <Text style={styles.batchText}>
                Preparing {shareProgress.done} of {shareProgress.total}
              </Text>
            </View>
          </View>
        )}

        {!!toast && (
          <View style={styles.toastWrap} pointerEvents="none">
            <View style={styles.toastCard}>
              <Text style={styles.toastText}>{toast}</Text>
            </View>
          </View>
        )}

        {sharePrompt && (
          <SharePromptModal
            initialMessage={sharePrompt.message}
            defaultMessage={sharePrompt.defaultMessage}
            suggestion={sharePrompt.suggestion}
            initialSkip={sharePrompt.skip}
            photoCount={sharePrompt.urls.length}
            onCancel={() => setSharePrompt(null)}
            onConfirm={(finalMessage, skip) => {
              const urls = sharePrompt.urls;
              const defaultMessage = sharePrompt.defaultMessage;
              setSharePrompt(null);
              if (skip) {
                AsyncStorage.setItem(SHARE_PROMPT_SKIP_KEY, "1").catch(() => {
                  // best-effort; preference will simply not persist
                });
              }
              void runShare(urls, finalMessage, defaultMessage);
            }}
          />
        )}

        {(!!caption || !!subtitle || !!logNote || canJumpToWorkOrder) && (
          <View style={styles.bottomBar} pointerEvents="box-none">
            {!!logNote &&
              (canJumpToLog ? (
                <Pressable
                  onPress={handleJumpToLog}
                  hitSlop={6}
                  accessibilityRole="link"
                  accessibilityLabel="Open this work log"
                  style={({ pressed }) => [
                    styles.logNoteRow,
                    pressed && { opacity: 0.7 },
                  ]}
                >
                  <Text style={styles.logNote} numberOfLines={2}>
                    {logNote}
                  </Text>
                  <View style={styles.openLogLink}>
                    <Text style={styles.openLogLinkText}>Open log</Text>
                    <Feather name="arrow-up-right" size={12} color="#fff" />
                  </View>
                </Pressable>
              ) : (
                <Text style={styles.logNote} numberOfLines={2}>
                  {logNote}
                </Text>
              ))}
            {canJumpToWorkOrder && (
              <Pressable
                onPress={handleJumpToWorkOrder}
                hitSlop={6}
                accessibilityRole="link"
                accessibilityLabel="Open this work order"
                style={({ pressed }) => [
                  styles.openLogLink,
                  styles.openWorkOrderLink,
                  pressed && { opacity: 0.7 },
                ]}
              >
                <Feather name="clipboard" size={12} color="#fff" />
                <Text style={styles.openLogLinkText}>Open work order</Text>
                <Feather name="arrow-up-right" size={12} color="#fff" />
              </Pressable>
            )}
            {!!caption && <Text style={styles.caption}>{caption}</Text>}
            {!!subtitle && <Text style={styles.subtitle}>{subtitle}</Text>}
          </View>
        )}
      </View>
    </Modal>
  );
}

function ZoomableImage({ uri, width, height }: { uri: string; width: number; height: number }) {
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const savedTranslateX = useSharedValue(0);
  const savedTranslateY = useSharedValue(0);
  const [zoomed, setZoomed] = useState(false);

  const setZoomedJS = (v: boolean) => setZoomed(v);

  const reset = () => {
    "worklet";
    scale.value = withTiming(1);
    savedScale.value = 1;
    translateX.value = withTiming(0);
    translateY.value = withTiming(0);
    savedTranslateX.value = 0;
    savedTranslateY.value = 0;
    runOnJS(setZoomedJS)(false);
  };

  const clampTranslation = () => {
    "worklet";
    const maxX = (width * (scale.value - 1)) / 2;
    const maxY = (height * (scale.value - 1)) / 2;
    if (translateX.value > maxX) translateX.value = withTiming(maxX);
    if (translateX.value < -maxX) translateX.value = withTiming(-maxX);
    if (translateY.value > maxY) translateY.value = withTiming(maxY);
    if (translateY.value < -maxY) translateY.value = withTiming(-maxY);
  };

  const pinch = Gesture.Pinch()
    .onUpdate((e) => {
      const next = Math.max(1, Math.min(5, savedScale.value * e.scale));
      scale.value = next;
    })
    .onEnd(() => {
      if (scale.value <= 1.05) {
        reset();
      } else {
        savedScale.value = scale.value;
        runOnJS(setZoomedJS)(true);
        clampTranslation();
      }
    });

  const pan = Gesture.Pan()
    .minPointers(1)
    .maxPointers(2)
    .averageTouches(true)
    .enabled(zoomed)
    .onUpdate((e) => {
      translateX.value = savedTranslateX.value + e.translationX;
      translateY.value = savedTranslateY.value + e.translationY;
    })
    .onEnd(() => {
      savedTranslateX.value = translateX.value;
      savedTranslateY.value = translateY.value;
      clampTranslation();
      savedTranslateX.value = translateX.value;
      savedTranslateY.value = translateY.value;
    });

  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd(() => {
      if (scale.value > 1.05) {
        reset();
      } else {
        scale.value = withTiming(2.5);
        savedScale.value = 2.5;
        runOnJS(setZoomedJS)(true);
      }
    });

  const composed = Gesture.Simultaneous(pinch, pan, doubleTap);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: scale.value },
    ],
  }));

  return (
    <View style={{ width, height, alignItems: "center", justifyContent: "center" }}>
      <GestureDetector gesture={composed}>
        <Animated.View style={[{ width, height }, animatedStyle]}>
          <Image
            source={{ uri }}
            style={{ width: "100%", height: "100%" }}
            resizeMode="contain"
          />
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#000" },
  topBar: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 12,
    backgroundColor: "rgba(0,0,0,0.35)",
  },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.12)",
  },
  counter: { color: "#fff", fontFamily: "Inter_600SemiBold", fontSize: 14 },
  topActions: { flexDirection: "row", alignItems: "center", gap: 8 },
  saveAllBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    height: 36,
    paddingHorizontal: 12,
    borderRadius: 18,
    backgroundColor: "rgba(255,255,255,0.12)",
  },
  saveAllBtnActive: {
    backgroundColor: "rgba(47,111,237,0.85)",
  },
  selectChip: {
    position: "absolute",
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: "rgba(0,0,0,0.65)",
  },
  selectChipBox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "transparent",
  },
  selectChipBoxOn: {
    backgroundColor: "#2f6fed",
    borderColor: "#2f6fed",
  },
  selectChipLabel: {
    color: "#fff",
    fontFamily: "Inter_600SemiBold",
    fontSize: 13,
  },
  saveAllLabel: {
    color: "#fff",
    fontFamily: "Inter_600SemiBold",
    fontSize: 13,
  },
  batchOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  batchCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: "rgba(0,0,0,0.75)",
  },
  batchText: {
    color: "#fff",
    fontFamily: "Inter_500Medium",
    fontSize: 14,
  },
  toastWrap: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: Platform.OS === "ios" ? 110 : 90,
    alignItems: "center",
    paddingHorizontal: 24,
  },
  toastCard: {
    maxWidth: 480,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: "rgba(0,0,0,0.8)",
  },
  toastText: {
    color: "#fff",
    fontFamily: "Inter_500Medium",
    fontSize: 13,
    textAlign: "center",
  },
  bottomBar: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 20,
    paddingTop: 14,
    paddingBottom: Platform.OS === "ios" ? 36 : 20,
    backgroundColor: "rgba(0,0,0,0.45)",
    alignItems: "center",
  },
  caption: { color: "#fff", fontFamily: "Inter_500Medium", fontSize: 13, textAlign: "center" },
  logNoteRow: {
    alignItems: "center",
    gap: 6,
    marginBottom: 6,
    maxWidth: 520,
  },
  logNote: {
    color: "#fff",
    fontFamily: "Inter_600SemiBold",
    fontSize: 14,
    textAlign: "center",
    marginBottom: 4,
  },
  openLogLink: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.18)",
  },
  openLogLinkText: {
    color: "#fff",
    fontFamily: "Inter_600SemiBold",
    fontSize: 11,
    letterSpacing: 0.2,
  },
  openWorkOrderLink: {
    alignSelf: "center",
    marginBottom: 6,
  },
  subtitle: {
    color: "rgba(255,255,255,0.75)",
    fontFamily: "Inter_400Regular",
    fontSize: 12,
    textAlign: "center",
    marginTop: 2,
  },
});
