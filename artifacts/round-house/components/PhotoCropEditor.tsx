import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import {
  GestureDetector,
  Gesture,
  GestureHandlerRootView,
} from "react-native-gesture-handler";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
} from "react-native-reanimated";
import * as ImageManipulator from "expo-image-manipulator";
import { useColors } from "@/hooks/useColors";

export type CropShape = "circle" | "roundedSquare";

type Props = {
  visible: boolean;
  sourceUri: string | null;
  /** Aspect ratio of the cutout: width / height (1 for circle/square). */
  aspect?: number;
  shape?: CropShape;
  title?: string;
  onCancel: () => void;
  onDone: (result: { uri: string; width: number; height: number }) => void;
};

const MAX_USER_SCALE = 8;

/**
 * Full-screen crop editor.
 * - The cutout never moves; the photo moves under it (pinch + pan).
 * - On Done, the visible region inside the cutout is cropped from the
 *   *original* photo via expo-image-manipulator and returned to the caller.
 */
export function PhotoCropEditor({
  visible,
  sourceUri,
  aspect = 1,
  shape = "circle",
  title = "Move and scale",
  onCancel,
  onDone,
}: Props) {
  const colors = useColors();
  const { width: winW, height: winH } = useWindowDimensions();

  const [imgDims, setImgDims] = useState<{ w: number; h: number } | null>(null);
  const [busy, setBusy] = useState(false);

  // Cutout sizing: leave horizontal padding, keep within screen height.
  const HPAD = 24;
  const cutW = Math.min(winW - HPAD * 2, 320);
  const cutH = cutW / aspect;

  // Reset gesture state whenever the source changes.
  const userScale = useSharedValue(1);
  const baseScale = useSharedValue(1); // accumulated scale across pinches
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const baseTx = useSharedValue(0);
  const baseTy = useSharedValue(0);

  useEffect(() => {
    if (!visible) return;
    setImgDims(null);
    tx.value = 0;
    ty.value = 0;
    baseTx.value = 0;
    baseTy.value = 0;
    if (sourceUri) {
      Image.getSize(
        sourceUri,
        (w, h) => setImgDims({ w, h }),
        () => setImgDims(null),
      );
    }
  }, [visible, sourceUri, tx, ty, baseTx, baseTy]);

  // Cover-fit base scale: photo always fully covers the cutout at userScale=1.
  const coverScale = useMemo(() => {
    if (!imgDims) return 1;
    return Math.max(cutW / imgDims.w, cutH / imgDims.h);
  }, [imgDims, cutW, cutH]);

  // Displayed (un-scaled-by-user) photo size = original × coverScale.
  // We render the photo at that base size and let the user multiply it.
  const baseImgW = imgDims ? imgDims.w * coverScale : cutW;
  const baseImgH = imgDims ? imgDims.h * coverScale : cutH;

  // Minimum user scale lets the user shrink past "cover" all the way to
  // "contain" (whole photo fits inside the cutout with margin if shorter
  // than the cutout on the other axis).
  const MIN_USER_SCALE = imgDims
    ? Math.min(cutW / baseImgW, cutH / baseImgH)
    : 1;

  // Initial scale = "contain": the entire photo fits inside the cutout the
  // moment the editor opens. The user can pinch to zoom in for a tighter
  // crop, or just hit Done to keep the whole logo visible.
  useEffect(() => {
    if (!imgDims) return;
    userScale.value = MIN_USER_SCALE;
    baseScale.value = MIN_USER_SCALE;
  }, [imgDims, MIN_USER_SCALE, userScale, baseScale]);

  const clampPan = (panX: number, panY: number, scale: number) => {
    "worklet";
    // When the photo is larger than the cutout, limit pan to the excess on
    // each side. When it's smaller, allow pan freely within the slack so the
    // user can place the photo anywhere inside the cutout.
    const maxX = Math.abs(baseImgW * scale - cutW) / 2;
    const maxY = Math.abs(baseImgH * scale - cutH) / 2;
    return {
      x: Math.min(maxX, Math.max(-maxX, panX)),
      y: Math.min(maxY, Math.max(-maxY, panY)),
    };
  };

  const pinch = Gesture.Pinch()
    .onUpdate((e) => {
      const next = Math.min(
        MAX_USER_SCALE,
        Math.max(MIN_USER_SCALE, baseScale.value * e.scale),
      );
      userScale.value = next;
      const clamped = clampPan(tx.value, ty.value, next);
      tx.value = clamped.x;
      ty.value = clamped.y;
    })
    .onEnd(() => {
      baseScale.value = userScale.value;
    });

  const pan = Gesture.Pan()
    .onUpdate((e) => {
      const next = clampPan(
        baseTx.value + e.translationX,
        baseTy.value + e.translationY,
        userScale.value,
      );
      tx.value = next.x;
      ty.value = next.y;
    })
    .onEnd(() => {
      baseTx.value = tx.value;
      baseTy.value = ty.value;
    });

  const composed = Gesture.Simultaneous(pinch, pan);

  const animStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: tx.value },
      { translateY: ty.value },
      { scale: userScale.value },
    ],
  }));

  async function handleDone() {
    if (!sourceUri || !imgDims) return;
    setBusy(true);
    try {
      const scale = userScale.value;
      const displayedW = baseImgW * scale;
      const displayedH = baseImgH * scale;

      // Top-left of the photo (in screen coords) relative to cutout center.
      const photoLeft = -displayedW / 2 + tx.value;
      const photoTop = -displayedH / 2 + ty.value;
      const cutLeft = -cutW / 2;
      const cutTop = -cutH / 2;

      // Convert screen-pixels offset → original-image pixels.
      const pxPerScreen = imgDims.w / displayedW; // === imgDims.h/displayedH
      const cropX = Math.max(0, (cutLeft - photoLeft) * pxPerScreen);
      const cropY = Math.max(0, (cutTop - photoTop) * pxPerScreen);
      const cropW = Math.min(imgDims.w - cropX, cutW * pxPerScreen);
      const cropH = Math.min(imgDims.h - cropY, cutH * pxPerScreen);

      const result = await ImageManipulator.manipulateAsync(
        sourceUri,
        [
          {
            crop: {
              originX: Math.round(cropX),
              originY: Math.round(cropY),
              width: Math.round(cropW),
              height: Math.round(cropH),
            },
          },
        ],
        { compress: 0.9, format: ImageManipulator.SaveFormat.JPEG },
      );
      onDone({ uri: result.uri, width: result.width, height: result.height });
    } catch (err) {
      console.warn("[PhotoCropEditor] crop failed", err);
      // Fall back to passing the original through so the user isn't blocked.
      onDone({ uri: sourceUri, width: imgDims.w, height: imgDims.h });
    } finally {
      setBusy(false);
    }
  }

  const onDonePress = () => {
    handleDone();
  };

  return (
    <Modal visible={visible} animationType="fade" transparent={false}>
      <GestureHandlerRootView style={{ flex: 1, backgroundColor: "#000" }}>
        {/* Top bar */}
        <View style={[styles.topBar, { borderBottomColor: "rgba(255,255,255,0.1)" }]}>
          <Pressable onPress={onCancel} hitSlop={12} disabled={busy}>
            <Text style={[styles.barText, { color: "#fff" }]}>Cancel</Text>
          </Pressable>
          <Text style={[styles.title, { color: "#fff" }]}>{title}</Text>
          <Pressable onPress={onDonePress} hitSlop={12} disabled={busy || !imgDims}>
            <Text
              style={[
                styles.barText,
                {
                  color: busy || !imgDims ? "rgba(255,255,255,0.4)" : colors.primary,
                  fontFamily: "Inter_700Bold",
                },
              ]}
            >
              {busy ? "Saving…" : "Done"}
            </Text>
          </Pressable>
        </View>

        {/* Photo + cutout overlay */}
        <View style={styles.stage}>
          <GestureDetector gesture={composed}>
            <View style={styles.gestureLayer}>
              {sourceUri && imgDims ? (
                <Animated.Image
                  source={{ uri: sourceUri }}
                  style={[
                    {
                      width: baseImgW,
                      height: baseImgH,
                      position: "absolute",
                    },
                    animStyle,
                  ]}
                  resizeMode="cover"
                />
              ) : (
                <ActivityIndicator color="#fff" />
              )}

              {/* Dim mask outside cutout — built from 4 rectangles around the
                  cutout so we don't need an SVG dependency. */}
              <View pointerEvents="none" style={StyleSheet.absoluteFillObject}>
                <View style={[styles.dim, { height: (winH - cutH) / 2, top: 0, left: 0, right: 0 }]} />
                <View style={[styles.dim, { height: (winH - cutH) / 2, bottom: 0, left: 0, right: 0 }]} />
                <View style={[styles.dim, { width: (winW - cutW) / 2, top: (winH - cutH) / 2, height: cutH, left: 0 }]} />
                <View style={[styles.dim, { width: (winW - cutW) / 2, top: (winH - cutH) / 2, height: cutH, right: 0 }]} />

                {/* Cutout outline */}
                <View
                  style={{
                    position: "absolute",
                    top: (winH - cutH) / 2,
                    left: (winW - cutW) / 2,
                    width: cutW,
                    height: cutH,
                    borderRadius: shape === "circle" ? cutW / 2 : 16,
                    borderWidth: 2,
                    borderColor: "rgba(255,255,255,0.95)",
                  }}
                />
              </View>
            </View>
          </GestureDetector>
        </View>

        <View style={styles.bottomHint}>
          <Text style={styles.hint}>Pinch to zoom · drag to position</Text>
        </View>
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 18,
    paddingTop: 56,
    paddingBottom: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  barText: { fontSize: 15, fontFamily: "Inter_500Medium" },
  title: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  stage: { flex: 1, alignItems: "center", justifyContent: "center" },
  gestureLayer: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center" },
  dim: { position: "absolute", backgroundColor: "rgba(0,0,0,0.65)" },
  bottomHint: {
    paddingBottom: 36,
    paddingTop: 16,
    alignItems: "center",
  },
  hint: { color: "rgba(255,255,255,0.7)", fontSize: 12, fontFamily: "Inter_500Medium" },
});
