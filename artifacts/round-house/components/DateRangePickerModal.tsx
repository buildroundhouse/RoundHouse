import React, { useEffect, useState } from "react";
import {
  Modal,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import DateTimePicker from "@react-native-community/datetimepicker";
import { useColors } from "@/hooks/useColors";
import {
  ANALYTICS_PRESETS,
  AnalyticsPreset,
  computePresetRange,
} from "@/lib/analyticsFilters";

interface Props {
  visible: boolean;
  onClose: () => void;
  onApply: (from: Date, to: Date) => void;
  initialFrom?: Date | null;
  initialTo?: Date | null;
}

function toYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function fromYmd(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (isNaN(d.getTime())) return null;
  return d;
}

function formatLong(d: Date): string {
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function DateRangePickerModal({
  visible,
  onClose,
  onApply,
  initialFrom,
  initialTo,
}: Props) {
  const colors = useColors();
  const [from, setFrom] = useState<Date>(
    initialFrom ?? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
  );
  const [to, setTo] = useState<Date>(initialTo ?? new Date());
  const [activeField, setActiveField] = useState<"from" | "to" | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      setFrom(initialFrom ?? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000));
      setTo(initialTo ?? new Date());
      setActiveField(null);
      setError(null);
    }
  }, [visible, initialFrom, initialTo]);

  const handleApply = () => {
    if (from.getTime() > to.getTime()) {
      setError("Start date must be on or before end date.");
      return;
    }
    const start = new Date(from);
    start.setHours(0, 0, 0, 0);
    const end = new Date(to);
    end.setHours(23, 59, 59, 999);
    onApply(start, end);
    onClose();
  };

  const isWeb = Platform.OS === "web";

  const applyPreset = (preset: AnalyticsPreset) => {
    const range = computePresetRange(preset);
    const lastInclusiveMs = Math.min(range.to.getTime() - 1, Date.now());
    const lastInclusive = new Date(
      Math.max(lastInclusiveMs, range.from.getTime()),
    );
    const newFrom = new Date(
      range.from.getFullYear(),
      range.from.getMonth(),
      range.from.getDate(),
    );
    const newTo = new Date(
      lastInclusive.getFullYear(),
      lastInclusive.getMonth(),
      lastInclusive.getDate(),
    );
    setFrom(newFrom);
    setTo(newTo);
    setActiveField(null);
    setError(null);
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <TouchableOpacity
        style={styles.backdrop}
        activeOpacity={1}
        onPress={onClose}
      >
        <TouchableOpacity
          activeOpacity={1}
          onPress={() => {}}
          style={[
            styles.card,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          <Text style={[styles.title, { color: colors.foreground }]}>
            Custom date range
          </Text>

          <View style={{ gap: 6 }}>
            <Text style={[styles.label, { color: colors.mutedForeground }]}>
              QUICK WINDOWS
            </Text>
            <View style={styles.presets}>
              {ANALYTICS_PRESETS.map((p) => (
                <TouchableOpacity
                  key={p.key}
                  onPress={() => applyPreset(p.key)}
                  style={[
                    styles.presetChip,
                    {
                      borderColor: colors.border,
                      backgroundColor: colors.background,
                    },
                  ]}
                >
                  <Text
                    style={[styles.presetText, { color: colors.foreground }]}
                  >
                    {p.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          <View style={{ gap: 12 }}>
            <View style={{ gap: 6 }}>
              <Text style={[styles.label, { color: colors.mutedForeground }]}>
                FROM
              </Text>
              {isWeb ? (
                <WebDateInput
                  value={toYmd(from)}
                  max={toYmd(to)}
                  onChange={(v) => {
                    const d = fromYmd(v);
                    if (d) {
                      setFrom(d);
                      setError(null);
                    }
                  }}
                  colors={colors}
                />
              ) : (
                <TouchableOpacity
                  onPress={() =>
                    setActiveField(activeField === "from" ? null : "from")
                  }
                  style={[
                    styles.fieldBtn,
                    {
                      borderColor:
                        activeField === "from" ? colors.primary : colors.border,
                      backgroundColor: colors.background,
                    },
                  ]}
                >
                  <Text style={[styles.fieldText, { color: colors.foreground }]}>
                    {formatLong(from)}
                  </Text>
                </TouchableOpacity>
              )}
              {!isWeb && activeField === "from" && (
                <DateTimePicker
                  value={from}
                  mode="date"
                  display={Platform.OS === "ios" ? "inline" : "default"}
                  maximumDate={to}
                  onChange={(_, d) => {
                    if (Platform.OS !== "ios") setActiveField(null);
                    if (d) {
                      setFrom(d);
                      setError(null);
                    }
                  }}
                />
              )}
            </View>

            <View style={{ gap: 6 }}>
              <Text style={[styles.label, { color: colors.mutedForeground }]}>
                TO
              </Text>
              {isWeb ? (
                <WebDateInput
                  value={toYmd(to)}
                  min={toYmd(from)}
                  max={toYmd(new Date())}
                  onChange={(v) => {
                    const d = fromYmd(v);
                    if (d) {
                      setTo(d);
                      setError(null);
                    }
                  }}
                  colors={colors}
                />
              ) : (
                <TouchableOpacity
                  onPress={() =>
                    setActiveField(activeField === "to" ? null : "to")
                  }
                  style={[
                    styles.fieldBtn,
                    {
                      borderColor:
                        activeField === "to" ? colors.primary : colors.border,
                      backgroundColor: colors.background,
                    },
                  ]}
                >
                  <Text style={[styles.fieldText, { color: colors.foreground }]}>
                    {formatLong(to)}
                  </Text>
                </TouchableOpacity>
              )}
              {!isWeb && activeField === "to" && (
                <DateTimePicker
                  value={to}
                  mode="date"
                  display={Platform.OS === "ios" ? "inline" : "default"}
                  minimumDate={from}
                  maximumDate={new Date()}
                  onChange={(_, d) => {
                    if (Platform.OS !== "ios") setActiveField(null);
                    if (d) {
                      setTo(d);
                      setError(null);
                    }
                  }}
                />
              )}
            </View>
          </View>

          {error && (
            <Text style={[styles.error, { color: colors.destructive }]}>
              {error}
            </Text>
          )}

          <View style={styles.actions}>
            <TouchableOpacity
              onPress={onClose}
              style={[styles.btn, { borderColor: colors.border }]}
            >
              <Text style={[styles.btnText, { color: colors.mutedForeground }]}>
                Cancel
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={handleApply}
              style={[
                styles.btn,
                styles.btnPrimary,
                { backgroundColor: colors.primary },
              ]}
            >
              <Text
                style={[styles.btnText, { color: colors.primaryForeground }]}
              >
                Apply
              </Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

function WebDateInput({
  value,
  onChange,
  min,
  max,
  colors,
}: {
  value: string;
  onChange: (v: string) => void;
  min?: string;
  max?: string;
  colors: ReturnType<typeof useColors>;
}) {
  return (
    <View
      style={[
        styles.fieldBtn,
        { borderColor: colors.border, backgroundColor: colors.background },
      ]}
    >
      {React.createElement("input", {
        type: "date",
        value,
        min,
        max,
        onChange: (e: { target: { value: string } }) => onChange(e.target.value),
        style: {
          border: "none",
          outline: "none",
          background: "transparent",
          color: colors.foreground,
          fontSize: 15,
          fontFamily: "Inter_500Medium",
          width: "100%",
          padding: 0,
        },
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
  },
  card: {
    width: "100%",
    maxWidth: 380,
    borderRadius: 16,
    borderWidth: 1,
    padding: 20,
    gap: 16,
  },
  title: { fontSize: 17, fontFamily: "Inter_700Bold" },
  label: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 0.8,
  },
  fieldBtn: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  fieldText: { fontSize: 15, fontFamily: "Inter_500Medium" },
  presets: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  presetChip: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  presetText: { fontSize: 13, fontFamily: "Inter_500Medium" },
  error: { fontSize: 12, fontFamily: "Inter_500Medium" },
  actions: { flexDirection: "row", gap: 10, justifyContent: "flex-end" },
  btn: {
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "transparent",
  },
  btnPrimary: {},
  btnText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
});
