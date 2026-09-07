import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as MediaLibrary from "expo-media-library";
import * as Sharing from "expo-sharing";
import * as FileSystem from "expo-file-system/legacy";

import {
  SHARE_PROMPT_LAST_NOTE_KEY,
  SHARE_PROMPT_SKIP_KEY,
  extractCustomNote,
} from "@/lib/sharePromptPref";

export type PhotoShareContext = {
  workOrderTitle?: string | null;
  propertyName?: string | null;
};

export type ShareResult = {
  outcome: "shared" | "downloaded" | "cancelled";
  count: number;
  total: number;
};

export function buildDefaultShareMessage(
  ctx: PhotoShareContext | undefined,
  count: number
): string {
  const photoLabel = `${count} photo${count === 1 ? "" : "s"}`;
  const title = ctx?.workOrderTitle?.trim();
  const property = ctx?.propertyName?.trim();
  if (title && property) return `${title} · ${property} · ${photoLabel}`;
  if (title) return `${title} · ${photoLabel}`;
  if (property) return `${property} · ${photoLabel}`;
  return photoLabel;
}

export function describeShareResult(r: ShareResult): string {
  const { outcome, count, total } = r;
  if (outcome === "cancelled") {
    return count > 0
      ? `Cancelled after sharing ${count} of ${total} photo${total === 1 ? "" : "s"}.`
      : "Share cancelled.";
  }
  const verb = outcome === "downloaded" ? "Downloaded" : "Shared";
  if (count === total) {
    return `${verb} ${count} photo${count === 1 ? "" : "s"}.`;
  }
  return `${verb} ${count} of ${total} photos. ${total - count} couldn't be prepared.`;
}

export function extFromUrl(url: string): string {
  try {
    const path = url.split("?")[0]?.split("#")[0] || "";
    const base = path.split("/").pop() || "";
    const dot = base.lastIndexOf(".");
    if (dot > 0 && dot < base.length - 1) {
      const ext = base.slice(dot + 1).toLowerCase();
      if (/^[a-z0-9]{2,5}$/.test(ext)) return ext;
    }
  } catch {
    // ignore
  }
  return "jpg";
}

export function filenameForUrl(url: string): string {
  return `roundhouse-${Date.now()}.${extFromUrl(url)}`;
}

function sanitizeFilenamePart(s: string): string {
  return s
    .replace(/[\\/:*?"<>|]+/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 60);
}

export function zipFilename(ctx?: PhotoShareContext): string {
  const title = sanitizeFilenamePart(ctx?.workOrderTitle?.trim() || "");
  if (title) return `${title}-photos.zip`;
  const property = sanitizeFilenamePart(ctx?.propertyName?.trim() || "");
  if (property) return `${property}-photos.zip`;
  return `roundhouse-photos-${Date.now()}.zip`;
}

export async function downloadOnWeb(url: string): Promise<void> {
  if (typeof window === "undefined" || typeof document === "undefined") {
    throw new Error("Download is unavailable.");
  }
  const name = filenameForUrl(url);
  try {
    const res = await fetch(url, { credentials: "include" });
    if (!res.ok) throw new Error(`Download failed (${res.status})`);
    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = objectUrl;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  } catch {
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    document.body.appendChild(a);
    a.click();
    a.remove();
  }
}

export async function saveToCameraRoll(
  url: string
): Promise<"saved" | "shared"> {
  const perm = await MediaLibrary.requestPermissionsAsync(true);
  if (!perm.granted) {
    if (perm.canAskAgain === false && (await Sharing.isAvailableAsync())) {
      const tmpUri = await downloadToCache(url);
      try {
        await Sharing.shareAsync(tmpUri, { dialogTitle: "Save photo" });
        return "shared";
      } finally {
        cleanupCacheFile(tmpUri);
      }
    }
    throw new Error("Permission to save photos was denied.");
  }
  const tmpUri = await downloadToCache(url);
  try {
    await MediaLibrary.saveToLibraryAsync(tmpUri);
    return "saved";
  } finally {
    cleanupCacheFile(tmpUri);
  }
}

export async function downloadToCache(url: string): Promise<string> {
  const baseDir = FileSystem.cacheDirectory;
  if (!baseDir) throw new Error("Cache directory unavailable.");
  const dir = `${baseDir}roundhouse-photos/`;
  try {
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  } catch {
    // already exists
  }
  const target = `${dir}${filenameForUrl(url)}`;
  const result = await FileSystem.downloadAsync(url, target);
  if (result.status < 200 || result.status >= 300) {
    throw new Error(`Download failed (${result.status})`);
  }
  return result.uri;
}

export function cleanupCacheFile(uri: string): void {
  FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {
    // best-effort cleanup
  });
}

export async function shareAllOnNative(
  urls: string[],
  message: string,
  ctx: PhotoShareContext | undefined,
  onProgress: (done: number) => void
): Promise<ShareResult> {
  const available = await Sharing.isAvailableAsync();
  if (!available) {
    throw new Error("Sharing is not available on this device.");
  }
  const cached: { uri: string; sourceUrl: string }[] = [];
  let zipPath: string | null = null;
  try {
    for (let i = 0; i < urls.length; i += 1) {
      try {
        const uri = await downloadToCache(urls[i]);
        cached.push({ uri, sourceUrl: urls[i] });
      } catch {
        // skip files we cannot fetch
      }
      onProgress(i + 1);
    }
    if (cached.length === 0) {
      throw new Error("Could not prepare any photos to share.");
    }
    const dialogTitle = message || "Share photos";
    if (cached.length === 1) {
      try {
        await Sharing.shareAsync(cached[0].uri, {
          dialogTitle,
          message,
        } as Sharing.SharingOptions);
        return { outcome: "shared", count: 1, total: urls.length };
      } catch {
        return { outcome: "cancelled", count: 0, total: urls.length };
      }
    }
    const entries: Record<string, Uint8Array> = {};
    const used = new Set<string>();
    for (const item of cached) {
      const b64 = await FileSystem.readAsStringAsync(item.uri, {
        encoding: FileSystem.EncodingType.Base64,
      });
      entries[uniqueZipName(filenameForUrl(item.sourceUrl), used)] =
        base64ToUint8Array(b64);
    }
    const { zipSync } = await import("fflate");
    const zipped = zipSync(entries, { level: 0 });
    const baseDir = FileSystem.cacheDirectory;
    if (!baseDir) throw new Error("Cache directory unavailable.");
    const dir = `${baseDir}roundhouse-photos/`;
    try {
      await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
    } catch {
      // already exists
    }
    zipPath = `${dir}${zipFilename(ctx)}`;
    await FileSystem.writeAsStringAsync(zipPath, uint8ArrayToBase64(zipped), {
      encoding: FileSystem.EncodingType.Base64,
    });
    try {
      await Sharing.shareAsync(zipPath, {
        dialogTitle,
        message,
        mimeType: "application/zip",
        UTI: "public.zip-archive",
      } as Sharing.SharingOptions);
      return { outcome: "shared", count: cached.length, total: urls.length };
    } catch {
      return { outcome: "cancelled", count: 0, total: urls.length };
    }
  } finally {
    for (const item of cached) cleanupCacheFile(item.uri);
    if (zipPath) cleanupCacheFile(zipPath);
  }
}

export async function shareAllOnWeb(
  urls: string[],
  message: string,
  ctx: PhotoShareContext | undefined,
  onProgress: (done: number) => void
): Promise<ShareResult> {
  if (typeof window === "undefined") {
    throw new Error("Sharing is unavailable.");
  }
  const nav: Navigator | undefined =
    typeof navigator !== "undefined" ? navigator : undefined;
  const hasShare = !!nav && typeof nav.share === "function";

  if (hasShare) {
    const files: File[] = [];
    for (let i = 0; i < urls.length; i += 1) {
      try {
        const url = urls[i];
        const res = await fetch(url, { credentials: "include" });
        if (res.ok) {
          const blob = await res.blob();
          const name = filenameForUrl(url);
          files.push(
            new File([blob], name, { type: blob.type || "image/jpeg" })
          );
        }
      } catch {
        // skip
      }
      onProgress(i + 1);
    }
    const canShareFiles =
      typeof nav!.canShare === "function" ? nav!.canShare({ files }) : true;
    if (files.length > 0 && canShareFiles) {
      try {
        await nav!.share({ files, title: "Photos", text: message });
        return { outcome: "shared", count: files.length, total: urls.length };
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") {
          return { outcome: "cancelled", count: 0, total: urls.length };
        }
      }
    }
  }

  const entries: Record<string, Uint8Array> = {};
  const usedNames = new Set<string>();
  for (let i = 0; i < urls.length; i += 1) {
    try {
      const url = urls[i];
      const res = await fetch(url, { credentials: "include" });
      if (res.ok) {
        const buf = new Uint8Array(await res.arrayBuffer());
        entries[uniqueZipName(filenameForUrl(url), usedNames)] = buf;
      }
    } catch {
      // skip unreachable files
    }
    onProgress(i + 1);
  }
  const names = Object.keys(entries);
  if (names.length === 0) {
    throw new Error("Could not prepare any photos to share.");
  }
  if (names.length === 1) {
    const blob = new Blob([entries[names[0]] as BlobPart], {
      type: "application/octet-stream",
    });
    triggerBlobDownload(blob, names[0]);
    return { outcome: "downloaded", count: names.length, total: urls.length };
  }
  const { zipSync } = await import("fflate");
  const zipped = zipSync(entries, { level: 0 });
  const blob = new Blob([zipped as BlobPart], { type: "application/zip" });
  triggerBlobDownload(blob, zipFilename(ctx));
  return { outcome: "downloaded", count: names.length, total: urls.length };
}

function base64ToUint8Array(b64: string): Uint8Array {
  const decoder: ((s: string) => string) | undefined =
    typeof atob === "function"
      ? atob
      : typeof globalThis !== "undefined" &&
        typeof (globalThis as { atob?: (s: string) => string }).atob ===
          "function"
      ? (globalThis as { atob: (s: string) => string }).atob
      : undefined;
  if (!decoder) throw new Error("Base64 decoder unavailable.");
  const bin = decoder(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

function uint8ArrayToBase64(u8: Uint8Array): string {
  const encoder: ((s: string) => string) | undefined =
    typeof btoa === "function"
      ? btoa
      : typeof globalThis !== "undefined" &&
        typeof (globalThis as { btoa?: (s: string) => string }).btoa ===
          "function"
      ? (globalThis as { btoa: (s: string) => string }).btoa
      : undefined;
  if (!encoder) throw new Error("Base64 encoder unavailable.");
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < u8.length; i += CHUNK) {
    const slice = u8.subarray(i, i + CHUNK);
    bin += String.fromCharCode.apply(
      null,
      Array.from(slice) as unknown as number[]
    );
  }
  return encoder(bin);
}

function uniqueZipName(name: string, used: Set<string>): string {
  if (!used.has(name)) {
    used.add(name);
    return name;
  }
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : "";
  let i = 2;
  let candidate = `${stem}-${i}${ext}`;
  while (used.has(candidate)) {
    i += 1;
    candidate = `${stem}-${i}${ext}`;
  }
  used.add(candidate);
  return candidate;
}

function triggerBlobDownload(blob: Blob, filename: string): void {
  if (typeof document === "undefined") return;
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = objectUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}

export function SharePromptModal({
  initialMessage,
  defaultMessage,
  suggestion,
  initialSkip,
  photoCount,
  onCancel,
  onConfirm,
}: {
  initialMessage: string;
  defaultMessage: string;
  suggestion: string;
  initialSkip: boolean;
  photoCount: number;
  onCancel: () => void;
  onConfirm: (message: string, skip: boolean) => void;
}) {
  const [message, setMessage] = useState(initialMessage);
  const [skip, setSkip] = useState(initialSkip);
  const trimmedSuggestion = suggestion.trim();
  const suggestionAlreadyApplied =
    !!trimmedSuggestion &&
    message.toLowerCase().includes(trimmedSuggestion.toLowerCase());
  const showSuggestion = !!trimmedSuggestion && !suggestionAlreadyApplied;
  const applySuggestion = () => {
    if (!trimmedSuggestion) return;
    const base = message.trim();
    if (!base) {
      setMessage(trimmedSuggestion);
      return;
    }
    if (base === defaultMessage.trim()) {
      setMessage(`${base} · ${trimmedSuggestion}`);
      return;
    }
    setMessage(`${base} ${trimmedSuggestion}`.trim());
  };
  const suggestionPreview =
    trimmedSuggestion.length > 60
      ? `${trimmedSuggestion.slice(0, 57)}…`
      : trimmedSuggestion;
  return (
    <Modal
      visible
      transparent
      animationType="fade"
      onRequestClose={onCancel}
      statusBarTranslucent
    >
      <View style={promptStyles.backdrop}>
        <View style={promptStyles.card}>
          <Text style={promptStyles.title}>Add a note</Text>
          <Text style={promptStyles.subtitle}>
            Sent with {photoCount} photo{photoCount === 1 ? "" : "s"} so the
            recipient knows what they're looking at.
          </Text>
          {showSuggestion && (
            <Pressable
              onPress={applySuggestion}
              hitSlop={6}
              accessibilityRole="button"
              accessibilityLabel={`Use last note: ${trimmedSuggestion}`}
              style={({ pressed }) => [
                promptStyles.suggestionChip,
                pressed && { opacity: 0.7 },
              ]}
            >
              <Feather name="rotate-ccw" size={12} color="#0f172a" />
              <Text style={promptStyles.suggestionLabel} numberOfLines={1}>
                Use last note: {suggestionPreview}
              </Text>
            </Pressable>
          )}
          <TextInput
            value={message}
            onChangeText={setMessage}
            multiline
            placeholder="Add a quick note…"
            placeholderTextColor="#999"
            style={promptStyles.input}
            accessibilityLabel="Share message"
          />
          <Pressable
            onPress={() => setSkip((s) => !s)}
            hitSlop={6}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: skip }}
            accessibilityLabel="Don't ask again"
            style={promptStyles.skipRow}
          >
            <View
              style={[
                promptStyles.checkbox,
                skip && promptStyles.checkboxChecked,
              ]}
            >
              {skip && <Feather name="check" size={14} color="#fff" />}
            </View>
            <Text style={promptStyles.skipLabel}>Don't ask again</Text>
          </Pressable>
          <View style={promptStyles.buttonRow}>
            <Pressable
              onPress={onCancel}
              hitSlop={6}
              style={({ pressed }) => [
                promptStyles.button,
                promptStyles.cancelButton,
                pressed && { opacity: 0.7 },
              ]}
              accessibilityRole="button"
              accessibilityLabel="Cancel share"
            >
              <Text style={promptStyles.cancelLabel}>Cancel</Text>
            </Pressable>
            <Pressable
              onPress={() => onConfirm(message, skip)}
              hitSlop={6}
              style={({ pressed }) => [
                promptStyles.button,
                promptStyles.shareButton,
                pressed && { opacity: 0.85 },
              ]}
              accessibilityRole="button"
              accessibilityLabel="Continue to share sheet"
            >
              <Feather name="share-2" size={14} color="#fff" />
              <Text style={promptStyles.shareLabel}>Share</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

export type PhotoBatchActions = {
  shareUrls: (urls: string[]) => void;
  saveUrls: (urls: string[]) => void;
  batchSaving: boolean;
  batchSharing: boolean;
  batchProgress: { done: number; total: number };
  shareProgress: { done: number; total: number };
  /** Renders the share-prompt modal, batch progress overlay, and toast. */
  overlay: React.ReactElement;
};

/**
 * Reusable hook that owns the batch share/save flow used by both the
 * full-screen viewer and the gallery's multi-select mode.
 */
export function usePhotoBatchActions({
  shareContext,
}: {
  shareContext?: PhotoShareContext;
}): PhotoBatchActions {
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
        await AsyncStorage.removeItem(SHARE_PROMPT_LAST_NOTE_KEY);
      }
    } catch {
      // best-effort persistence
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
      const message =
        err instanceof Error ? err.message : "Could not share photos.";
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

  const shareUrls = (urls: string[]) => {
    if (batchSharing || batchSaving) return;
    if (urls.length === 0) return;
    void (async () => {
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
    })();
  };

  const saveUrls = (urls: string[]) => {
    if (batchSaving || batchSharing) return;
    if (urls.length === 0) return;
    void (async () => {
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
        const message =
          err instanceof Error ? err.message : "Could not save photos.";
        if (Platform.OS === "web") {
          showToast(message);
        } else {
          Alert.alert("Save failed", message);
        }
      } finally {
        setBatchSaving(false);
        setBatchProgress({ done: 0, total: 0 });
      }
    })();
  };

  const overlay = useMemo(
    () => (
      <>
        {batchSaving && batchProgress.total > 0 && (
          <View style={overlayStyles.batchOverlay} pointerEvents="none">
            <View style={overlayStyles.batchCard}>
              <ActivityIndicator size="small" color="#fff" />
              <Text style={overlayStyles.batchText}>
                {Platform.OS === "web" ? "Downloading" : "Saving"}{" "}
                {batchProgress.done} of {batchProgress.total}
              </Text>
            </View>
          </View>
        )}
        {batchSharing && shareProgress.total > 0 && (
          <View style={overlayStyles.batchOverlay} pointerEvents="none">
            <View style={overlayStyles.batchCard}>
              <ActivityIndicator size="small" color="#fff" />
              <Text style={overlayStyles.batchText}>
                Preparing {shareProgress.done} of {shareProgress.total}
              </Text>
            </View>
          </View>
        )}
        {!!toast && (
          <View style={overlayStyles.toastWrap} pointerEvents="none">
            <View style={overlayStyles.toastCard}>
              <Text style={overlayStyles.toastText}>{toast}</Text>
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
                  // best-effort
                });
              }
              void runShare(urls, finalMessage, defaultMessage);
            }}
          />
        )}
      </>
    ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [batchSaving, batchProgress, batchSharing, shareProgress, toast, sharePrompt]
  );

  return {
    shareUrls,
    saveUrls,
    batchSaving,
    batchSharing,
    batchProgress,
    shareProgress,
    overlay,
  };
}

const overlayStyles = StyleSheet.create({
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
});

const promptStyles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.55)",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
  },
  card: {
    width: "100%",
    maxWidth: 420,
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 20,
  },
  title: {
    fontFamily: "Inter_700Bold",
    fontSize: 18,
    color: "#111",
    marginBottom: 4,
  },
  subtitle: {
    fontFamily: "Inter_400Regular",
    fontSize: 13,
    color: "#555",
    marginBottom: 14,
  },
  suggestionChip: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: "#eef2ff",
    borderWidth: 1,
    borderColor: "#c7d2fe",
    marginBottom: 8,
    maxWidth: "100%",
  },
  suggestionLabel: {
    fontFamily: "Inter_500Medium",
    fontSize: 12,
    color: "#0f172a",
    flexShrink: 1,
  },
  input: {
    minHeight: 92,
    borderWidth: 1,
    borderColor: "#d8d8d8",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontFamily: "Inter_400Regular",
    fontSize: 14,
    color: "#111",
    textAlignVertical: "top",
    backgroundColor: "#fafafa",
  },
  skipRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginTop: 14,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: "#bbb",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#fff",
  },
  checkboxChecked: {
    backgroundColor: "#2f6fed",
    borderColor: "#2f6fed",
  },
  skipLabel: {
    fontFamily: "Inter_500Medium",
    fontSize: 13,
    color: "#333",
  },
  buttonRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 10,
    marginTop: 18,
  },
  button: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
  },
  cancelButton: {
    backgroundColor: "#eee",
  },
  cancelLabel: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 14,
    color: "#333",
  },
  shareButton: {
    backgroundColor: "#2f6fed",
  },
  shareLabel: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 14,
    color: "#fff",
  },
});
