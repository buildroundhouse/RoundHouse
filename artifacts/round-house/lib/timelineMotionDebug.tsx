import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

const STORAGE_KEY = "rh.timelineMotionDebug.v1";
const CUSTOM_PRESET_NAME = "Custom";

export type SpringConfig = {
  mass: number;
  damping: number;
  stiffness: number;
  overshootClamping: boolean;
};

export type TimelineMotionConfig = {
  open: SpringConfig;
  close: SpringConfig;
  reveal: { mass: number; damping: number; stiffness: number; baseDelayMs: number; stepDelayMs: number };
  blur: { ios: number; android: number };
  scrimOpacity: number;
};

// Shipping defaults.
// Open/close/reveal springs and iOS blur/scrim were validated on real iPhone
// hardware and felt great — promoted from the debug panel. The Android blur
// value has not been verified on a physical Android device yet; it stays at
// the previous baseline until someone can sit with it on a real device.
const DEFAULT: TimelineMotionConfig = {
  open: { mass: 0.9, damping: 18, stiffness: 190, overshootClamping: false },
  close: { mass: 0.7, damping: 24, stiffness: 230, overshootClamping: true },
  reveal: { mass: 0.8, damping: 20, stiffness: 180, baseDelayMs: 60, stepDelayMs: 55 },
  blur: { ios: 28, android: 70 },
  scrimOpacity: 0.22,
};

export const TIMELINE_MOTION_PRESETS: { name: string; description: string; config: TimelineMotionConfig }[] = [
  {
    name: "Default",
    description: "Shipping values. Verified on iPhone; Android blur not yet device-tested.",
    config: DEFAULT,
  },
  {
    name: "Snappy (low-end Android)",
    description: "Stiffer, clamped, lighter blur — best if spring feels cheap or blur stutters.",
    config: {
      open: { mass: 0.7, damping: 22, stiffness: 240, overshootClamping: true },
      close: { mass: 0.6, damping: 26, stiffness: 260, overshootClamping: true },
      reveal: { mass: 0.7, damping: 22, stiffness: 220, baseDelayMs: 40, stepDelayMs: 40 },
      blur: { ios: 28, android: 50 },
      scrimOpacity: 0.3,
    },
  },
  {
    name: "Loose (premium iOS feel)",
    description: "More overshoot, softer blur. Can feel floaty on Android.",
    config: {
      open: { mass: 1.0, damping: 15, stiffness: 170, overshootClamping: false },
      close: { mass: 0.8, damping: 22, stiffness: 210, overshootClamping: false },
      reveal: { mass: 0.9, damping: 18, stiffness: 160, baseDelayMs: 80, stepDelayMs: 70 },
      blur: { ios: 32, android: 80 },
      scrimOpacity: 0.18,
    },
  },
  {
    name: "Heavy blur",
    description: "Push background further back. Use if timeline behind feels too present.",
    config: {
      ...DEFAULT,
      blur: { ios: 40, android: 90 },
      scrimOpacity: 0.32,
    },
  },
  {
    name: "No spring (decisive)",
    description: "High damping both ways — closest to a timing curve. Useful as a feel baseline.",
    config: {
      open: { mass: 0.5, damping: 30, stiffness: 260, overshootClamping: true },
      close: { mass: 0.5, damping: 32, stiffness: 280, overshootClamping: true },
      reveal: { mass: 0.6, damping: 28, stiffness: 240, baseDelayMs: 30, stepDelayMs: 30 },
      blur: { ios: 28, android: 70 },
      scrimOpacity: 0.22,
    },
  },
];

let current: TimelineMotionConfig = DEFAULT;
let currentPresetName: string = "Default";
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

function persist() {
  const payload = JSON.stringify({ presetName: currentPresetName, config: current });
  AsyncStorage.setItem(STORAGE_KEY, payload).catch(() => {
    // In-memory state is still authoritative; persistence is best-effort.
  });
}

function isSpringConfig(v: any): v is SpringConfig {
  return (
    v &&
    typeof v.mass === "number" &&
    typeof v.damping === "number" &&
    typeof v.stiffness === "number" &&
    typeof v.overshootClamping === "boolean"
  );
}

function isTimelineMotionConfig(v: any): v is TimelineMotionConfig {
  return (
    v &&
    isSpringConfig(v.open) &&
    isSpringConfig(v.close) &&
    v.reveal &&
    typeof v.reveal.mass === "number" &&
    typeof v.reveal.damping === "number" &&
    typeof v.reveal.stiffness === "number" &&
    typeof v.reveal.baseDelayMs === "number" &&
    typeof v.reveal.stepDelayMs === "number" &&
    v.blur &&
    typeof v.blur.ios === "number" &&
    typeof v.blur.android === "number" &&
    typeof v.scrimOpacity === "number"
  );
}

let hydrationPromise: Promise<void> | null = null;
let hasLocalWrite = false;

function hydrate(): Promise<void> {
  if (hydrationPromise) return hydrationPromise;
  hydrationPromise = AsyncStorage.getItem(STORAGE_KEY)
    .then((raw) => {
      if (!raw) return;
      // Don't clobber a value the user already set this session.
      if (hasLocalWrite) return;
      try {
        const parsed = JSON.parse(raw);
        if (parsed && isTimelineMotionConfig(parsed.config)) {
          current = parsed.config;
          currentPresetName =
            typeof parsed.presetName === "string" && parsed.presetName.length > 0
              ? parsed.presetName
              : CUSTOM_PRESET_NAME;
          emit();
        }
      } catch {
        // Ignore corrupted payloads — fall back to defaults.
      }
    })
    .catch(() => {
      // ignore
    });
  return hydrationPromise;
}

// Kick off hydration as soon as the module loads.
hydrate();

export function getTimelineMotionConfig(): TimelineMotionConfig {
  return current;
}

export function getTimelineMotionPresetName(): string {
  return currentPresetName;
}

export function setTimelineMotionConfig(next: TimelineMotionConfig, presetName: string = CUSTOM_PRESET_NAME) {
  current = next;
  currentPresetName = presetName;
  hasLocalWrite = true;
  emit();
  persist();
}

export function applyPreset(name: string) {
  const preset = TIMELINE_MOTION_PRESETS.find((p) => p.name === name);
  if (preset) setTimelineMotionConfig(preset.config, preset.name);
}

export function resetTimelineMotionConfig() {
  current = DEFAULT;
  currentPresetName = "Default";
  hasLocalWrite = true;
  emit();
  AsyncStorage.removeItem(STORAGE_KEY).catch(() => {
    // ignore
  });
}

export function useTimelineMotionConfig(): TimelineMotionConfig {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => current,
    () => current,
  );
}

export function useTimelineMotionPresetName(): string {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => currentPresetName,
    () => currentPresetName,
  );
}

// A ref-backed accessor so animation callbacks always read the latest value
// without needing to re-run effects on every preset change.
export function useTimelineMotionConfigRef() {
  const cfg = useTimelineMotionConfig();
  const ref = useRef(cfg);
  ref.current = cfg;
  return ref;
}

// ---------------------------------------------------------------------------
// Floating debug panel
// ---------------------------------------------------------------------------

function Stepper({
  label,
  value,
  step,
  min,
  max,
  fractionDigits = 0,
  onChange,
}: {
  label: string;
  value: number;
  step: number;
  min: number;
  max: number;
  fractionDigits?: number;
  onChange: (v: number) => void;
}) {
  const clamp = (v: number) => Math.max(min, Math.min(max, Math.round(v * 1000) / 1000));
  return (
    <View style={panelStyles.row}>
      <Text style={panelStyles.rowLabel}>{label}</Text>
      <View style={panelStyles.stepperGroup}>
        <Pressable style={panelStyles.stepBtn} onPress={() => onChange(clamp(value - step))}>
          <Text style={panelStyles.stepBtnText}>−</Text>
        </Pressable>
        <Text style={panelStyles.stepValue}>{value.toFixed(fractionDigits)}</Text>
        <Pressable style={panelStyles.stepBtn} onPress={() => onChange(clamp(value + step))}>
          <Text style={panelStyles.stepBtnText}>+</Text>
        </Pressable>
      </View>
    </View>
  );
}

function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <Pressable style={panelStyles.row} onPress={() => onChange(!value)}>
      <Text style={panelStyles.rowLabel}>{label}</Text>
      <View style={[panelStyles.toggle, value && panelStyles.toggleOn]}>
        <Text style={panelStyles.toggleText}>{value ? "ON" : "OFF"}</Text>
      </View>
    </Pressable>
  );
}

export function TimelineMotionDebugPanel({ enabled = __DEV__ }: { enabled?: boolean }) {
  const cfg = useTimelineMotionConfig();
  const activePreset = useTimelineMotionPresetName();
  const [open, setOpen] = useState(false);

  const update = useCallback(<K extends keyof TimelineMotionConfig>(key: K, value: TimelineMotionConfig[K]) => {
    setTimelineMotionConfig({ ...current, [key]: value });
  }, []);

  if (!enabled) return null;

  return (
    <>
      <Pressable
        style={panelStyles.fab}
        onPress={() => setOpen(true)}
        accessibilityLabel="Open timeline motion debug panel"
      >
        <Text style={panelStyles.fabText}>TL</Text>
      </Pressable>
      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <View style={panelStyles.backdrop}>
          <View style={panelStyles.sheet}>
            <View style={panelStyles.header}>
              <Text style={panelStyles.title}>Timeline overlay motion</Text>
              <Pressable onPress={() => setOpen(false)} hitSlop={12}>
                <Text style={panelStyles.close}>Done</Text>
              </Pressable>
            </View>
            <Text style={panelStyles.platformNote}>
              Platform: {Platform.OS} · Active preset: {activePreset}
            </Text>
            <ScrollView contentContainerStyle={panelStyles.body}>
              <Text style={panelStyles.sectionTitle}>Presets</Text>
              {TIMELINE_MOTION_PRESETS.map((p) => (
                <Pressable
                  key={p.name}
                  style={[panelStyles.preset, activePreset === p.name && panelStyles.presetActive]}
                  onPress={() => {
                    applyPreset(p.name);
                  }}
                >
                  <Text style={panelStyles.presetName}>{p.name}</Text>
                  <Text style={panelStyles.presetDesc}>{p.description}</Text>
                </Pressable>
              ))}

              <Text style={panelStyles.sectionTitle}>Open spring</Text>
              <Stepper
                label="mass"
                value={cfg.open.mass}
                step={0.1}
                min={0.1}
                max={3}
                fractionDigits={2}
                onChange={(v) => update("open", { ...cfg.open, mass: v })}
              />
              <Stepper
                label="damping"
                value={cfg.open.damping}
                step={1}
                min={1}
                max={60}
                onChange={(v) => update("open", { ...cfg.open, damping: v })}
              />
              <Stepper
                label="stiffness"
                value={cfg.open.stiffness}
                step={10}
                min={20}
                max={500}
                onChange={(v) => update("open", { ...cfg.open, stiffness: v })}
              />
              <Toggle
                label="clamp overshoot"
                value={cfg.open.overshootClamping}
                onChange={(v) => update("open", { ...cfg.open, overshootClamping: v })}
              />

              <Text style={panelStyles.sectionTitle}>Close spring</Text>
              <Stepper
                label="mass"
                value={cfg.close.mass}
                step={0.1}
                min={0.1}
                max={3}
                fractionDigits={2}
                onChange={(v) => update("close", { ...cfg.close, mass: v })}
              />
              <Stepper
                label="damping"
                value={cfg.close.damping}
                step={1}
                min={1}
                max={60}
                onChange={(v) => update("close", { ...cfg.close, damping: v })}
              />
              <Stepper
                label="stiffness"
                value={cfg.close.stiffness}
                step={10}
                min={20}
                max={500}
                onChange={(v) => update("close", { ...cfg.close, stiffness: v })}
              />
              <Toggle
                label="clamp overshoot"
                value={cfg.close.overshootClamping}
                onChange={(v) => update("close", { ...cfg.close, overshootClamping: v })}
              />

              <Text style={panelStyles.sectionTitle}>Detail reveal</Text>
              <Stepper
                label="base delay (ms)"
                value={cfg.reveal.baseDelayMs}
                step={10}
                min={0}
                max={400}
                onChange={(v) => update("reveal", { ...cfg.reveal, baseDelayMs: v })}
              />
              <Stepper
                label="stagger step (ms)"
                value={cfg.reveal.stepDelayMs}
                step={5}
                min={0}
                max={200}
                onChange={(v) => update("reveal", { ...cfg.reveal, stepDelayMs: v })}
              />
              <Stepper
                label="damping"
                value={cfg.reveal.damping}
                step={1}
                min={1}
                max={60}
                onChange={(v) => update("reveal", { ...cfg.reveal, damping: v })}
              />
              <Stepper
                label="stiffness"
                value={cfg.reveal.stiffness}
                step={10}
                min={20}
                max={500}
                onChange={(v) => update("reveal", { ...cfg.reveal, stiffness: v })}
              />

              <Text style={panelStyles.sectionTitle}>Blur & scrim</Text>
              <Stepper
                label="iOS blur intensity"
                value={cfg.blur.ios}
                step={2}
                min={0}
                max={100}
                onChange={(v) => update("blur", { ...cfg.blur, ios: v })}
              />
              <Stepper
                label="Android blur intensity"
                value={cfg.blur.android}
                step={5}
                min={0}
                max={100}
                onChange={(v) => update("blur", { ...cfg.blur, android: v })}
              />
              <Stepper
                label="scrim opacity"
                value={cfg.scrimOpacity}
                step={0.02}
                min={0}
                max={0.8}
                fractionDigits={2}
                onChange={(v) => update("scrimOpacity", v)}
              />

              <Pressable
                style={panelStyles.resetBtn}
                onPress={() => {
                  resetTimelineMotionConfig();
                }}
              >
                <Text style={panelStyles.resetBtnText}>Reset to default</Text>
              </Pressable>
              <View style={{ height: 32 }} />
            </ScrollView>
          </View>
        </View>
      </Modal>
    </>
  );
}

const panelStyles = StyleSheet.create({
  fab: {
    position: "absolute",
    right: 12,
    bottom: 96,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "rgba(20,24,36,0.85)",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 9999,
    elevation: 12,
    shadowColor: "#000",
    shadowOpacity: 0.3,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
  },
  fabText: { color: "#fff", fontWeight: "700", fontSize: 12, letterSpacing: 0.5 },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  sheet: {
    backgroundColor: "#11151f",
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    maxHeight: "85%",
    paddingHorizontal: 16,
    paddingTop: 14,
  },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  title: { color: "#fff", fontSize: 16, fontWeight: "700" },
  close: { color: "#7fb1ff", fontSize: 14, fontWeight: "600" },
  platformNote: { color: "#8a93a6", fontSize: 12, marginTop: 4, marginBottom: 8 },
  body: { paddingBottom: 12 },
  sectionTitle: {
    color: "#cdd6e6",
    fontSize: 12,
    textTransform: "uppercase",
    letterSpacing: 0.8,
    marginTop: 14,
    marginBottom: 6,
    fontWeight: "700",
  },
  preset: {
    backgroundColor: "#1a2030",
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginBottom: 6,
    borderWidth: 1,
    borderColor: "transparent",
  },
  presetActive: { borderColor: "#7fb1ff" },
  presetName: { color: "#fff", fontWeight: "600", fontSize: 14 },
  presetDesc: { color: "#8a93a6", fontSize: 12, marginTop: 2 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#222a3a",
  },
  rowLabel: { color: "#dde3ee", fontSize: 14 },
  stepperGroup: { flexDirection: "row", alignItems: "center", gap: 8 },
  stepBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "#1d2434",
    alignItems: "center",
    justifyContent: "center",
  },
  stepBtnText: { color: "#fff", fontSize: 18, fontWeight: "700", lineHeight: 20 },
  stepValue: { color: "#fff", fontVariant: ["tabular-nums"], minWidth: 56, textAlign: "center", fontSize: 14 },
  toggle: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 14, backgroundColor: "#1d2434" },
  toggleOn: { backgroundColor: "#2b6fd6" },
  toggleText: { color: "#fff", fontSize: 12, fontWeight: "700" },
  resetBtn: {
    marginTop: 18,
    backgroundColor: "#2b6fd6",
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: "center",
  },
  resetBtnText: { color: "#fff", fontWeight: "700" },
});
