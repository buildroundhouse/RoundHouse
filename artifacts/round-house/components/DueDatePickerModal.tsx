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
import { confirm } from "@/lib/confirm";

interface Props {
  visible: boolean;
  onClose: () => void;
  onApply: (iso: string) => void;
  onClear?: () => void;
  initialDate?: string | null;
  minimumDate?: Date;
  title?: string;
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
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function defaultStart(initial: string | null | undefined): Date {
  if (initial) {
    const d = new Date(initial);
    if (!isNaN(d.getTime())) return d;
  }
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d;
}

export function DueDatePickerModal({
  visible,
  onClose,
  onApply,
  onClear,
  initialDate,
  minimumDate,
  title = "Pick a due date",
}: Props) {
  const colors = useColors();
  const [date, setDate] = useState<Date>(defaultStart(initialDate));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      setDate(defaultStart(initialDate));
      setError(null);
    }
  }, [visible, initialDate]);

  const min = minimumDate ?? (() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  })();

  const handleApply = () => {
    if (date.getTime() < min.getTime()) {
      setError("Pick today or a later date.");
      return;
    }
    const out = new Date(date);
    out.setHours(17, 0, 0, 0);
    onApply(out.toISOString());
    onClose();
  };

  const isWeb = Platform.OS === "web";

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
            {title}
          </Text>

          <View style={{ gap: 6 }}>
            <Text style={[styles.label, { color: colors.mutedForeground }]}>
              DATE
            </Text>
            {isWeb ? (
              <View
                style={[
                  styles.fieldBtn,
                  {
                    borderColor: colors.border,
                    backgroundColor: colors.background,
                  },
                ]}
              >
                {React.createElement("input", {
                  type: "date",
                  value: toYmd(date),
                  min: toYmd(min),
                  onChange: (e: { target: { value: string } }) => {
                    const d = fromYmd(e.target.value);
                    if (d) {
                      setDate(d);
                      setError(null);
                    }
                  },
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
            ) : (
              <>
                <View
                  style={[
                    styles.fieldBtn,
                    {
                      borderColor: colors.border,
                      backgroundColor: colors.background,
                    },
                  ]}
                >
                  <Text style={[styles.fieldText, { color: colors.foreground }]}>
                    {formatLong(date)}
                  </Text>
                </View>
                <DateTimePicker
                  value={date}
                  mode="date"
                  display={Platform.OS === "ios" ? "inline" : "default"}
                  minimumDate={min}
                  onChange={(_, d) => {
                    if (d) {
                      setDate(d);
                      setError(null);
                    }
                  }}
                />
              </>
            )}
          </View>

          {error && (
            <Text style={[styles.error, { color: colors.destructive }]}>
              {error}
            </Text>
          )}

          {onClear && initialDate ? (
            <TouchableOpacity
              onPress={async () => {
                // #627: Use the cross-platform confirm helper so the
                // dialog surfaces on react-native-web and native alike.
                const ok = await confirm({
                  title: "Clear due date?",
                  message: "Remove the due date for this job?",
                  confirmLabel: "Clear",
                  cancelLabel: "Cancel",
                  destructive: true,
                });
                if (!ok) return;
                onClear();
                onClose();
              }}
              style={[
                styles.clearBtn,
                { borderColor: colors.destructive + "55" },
              ]}
            >
              <Text
                style={[styles.btnText, { color: colors.destructive }]}
              >
                Clear due date
              </Text>
            </TouchableOpacity>
          ) : null}

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
                { backgroundColor: colors.primary },
              ]}
            >
              <Text
                style={[styles.btnText, { color: colors.primaryForeground }]}
              >
                Set due date
              </Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
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
  error: { fontSize: 12, fontFamily: "Inter_500Medium" },
  clearBtn: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: "center",
  },
  actions: { flexDirection: "row", gap: 10, justifyContent: "flex-end" },
  btn: {
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "transparent",
  },
  btnText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
});
