import React, { useCallback, useMemo, useRef, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type LayoutChangeEvent,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import {
  isIntakeComplete,
  type IntakeField,
  type ModeIntake,
} from "@/lib/intake-schemas";
import { ZipPicker } from "./ZipPicker";
import { AddressAutocompleteInput } from "./AddressAutocompleteInput";

interface Props {
  intake: ModeIntake;
  initialData?: Record<string, unknown>;
  submitLabel?: string;
  onSubmit: (data: Record<string, unknown>) => Promise<void> | void;
  onClose?: () => void;
}

const ERROR_COLOR = "#E55";

function getFieldError(field: IntakeField, value: unknown): string | null {
  if (!field.required) return null;
  const isEmpty = (() => {
    if (field.kind === "multi-select" || field.kind === "zip-list") {
      return !Array.isArray(value) || value.length === 0;
    }
    if (field.kind === "single-select") {
      return value == null || (typeof value === "string" && value.trim().length === 0);
    }
    return typeof value !== "string" || value.trim().length === 0;
  })();
  if (isEmpty) return "Required";
  if (
    field.kind === "zip" &&
    typeof value === "string" &&
    !/^\d{5}$/.test(value.trim())
  ) {
    return "Enter a 5-digit ZIP.";
  }
  return null;
}

export function IntakeForm({
  intake,
  initialData,
  submitLabel = "Continue",
  onSubmit,
  onClose,
}: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [data, setData] = useState<Record<string, unknown>>(initialData ?? {});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [submitAttempted, setSubmitAttempted] = useState(false);

  const scrollRef = useRef<ScrollView | null>(null);
  const fieldYRef = useRef<Record<string, number>>({});

  const setValue = (key: string, value: unknown) => {
    setData((d) => ({ ...d, [key]: value }));
    setTouched((t) => (t[key] ? t : { ...t, [key]: true }));
    setError("");
  };

  const markTouched = useCallback((key: string) => {
    setTouched((t) => (t[key] ? t : { ...t, [key]: true }));
  }, []);

  const ready = isIntakeComplete(intake, data);

  const missing = useMemo(
    () =>
      intake.fields
        .map((f) => ({ field: f, err: getFieldError(f, data[f.key]) }))
        .filter((m) => m.err != null),
    [intake, data],
  );

  const submit = async () => {
    if (submitting) return;
    if (!ready || missing.length > 0) {
      setSubmitAttempted(true);
      const first = missing[0]?.field.key;
      if (first) {
        const y = fieldYRef.current[first];
        if (typeof y === "number") {
          scrollRef.current?.scrollTo({ y: Math.max(y - 16, 0), animated: true });
        }
      }
      return;
    }
    setSubmitting(true);
    try {
      await onSubmit(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  };

  const hasInteracted = submitAttempted || Object.keys(touched).length > 0;
  const showSummary = submitAttempted && missing.length > 0;
  const summaryText =
    missing.length > 0
      ? `Please complete: ${missing.map((m) => m.field.label).join(", ")}`
      : "";

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={{ flex: 1 }}
    >
      {onClose ? (
        <View
          style={[
            styles.header,
            {
              paddingTop: insets.top + 8,
              borderBottomColor: colors.border,
              backgroundColor: colors.background,
            },
          ]}
        >
          <Pressable
            onPress={onClose}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="Close"
            style={({ pressed }) => [styles.headerBtn, { opacity: pressed ? 0.6 : 1 }]}
          >
            <Feather name="x" size={22} color={colors.foreground} />
          </Pressable>
          <Text style={[styles.headerTitle, { color: colors.foreground }]} numberOfLines={1}>
            {intake.title}
          </Text>
          <View style={styles.headerBtn} />
        </View>
      ) : null}
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={[
          styles.scroll,
          {
            paddingTop: onClose ? 16 : insets.top + 24,
            paddingBottom: insets.bottom + 24,
          },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        {!onClose ? (
          <Text style={[styles.title, { color: colors.foreground }]}>{intake.title}</Text>
        ) : null}
        {intake.intro ? (
          <Text style={[styles.intro, { color: colors.mutedForeground }]}>{intake.intro}</Text>
        ) : null}

        <View style={styles.fields}>
          {intake.fields.map((field) => {
            const fieldError = getFieldError(field, data[field.key]);
            const showError = fieldError != null && hasInteracted;
            return (
              <View
                key={field.key}
                onLayout={(e: LayoutChangeEvent) => {
                  fieldYRef.current[field.key] = e.nativeEvent.layout.y;
                }}
              >
                <FieldRenderer
                  field={field}
                  value={data[field.key]}
                  onChange={(v) => setValue(field.key, v)}
                  onBlur={() => markTouched(field.key)}
                  allValues={data}
                  errorText={showError ? fieldError : null}
                />
              </View>
            );
          })}
        </View>

        {error ? <Text style={[styles.error, { color: ERROR_COLOR }]}>{error}</Text> : null}

        {showSummary ? (
          <View
            style={[
              styles.summary,
              { backgroundColor: ERROR_COLOR + "1A", borderColor: ERROR_COLOR },
            ]}
          >
            <Feather name="alert-circle" size={16} color={ERROR_COLOR} />
            <Text style={[styles.summaryText, { color: ERROR_COLOR }]}>{summaryText}</Text>
          </View>
        ) : null}

        <Pressable
          onPress={submit}
          disabled={submitting}
          style={[
            styles.btn,
            { backgroundColor: ready ? colors.primary : colors.muted },
            submitting && { opacity: 0.6 },
          ]}
          accessibilityRole="button"
          accessibilityState={{ disabled: submitting }}
          accessibilityHint={
            !ready
              ? "Tap to see which required fields are still missing."
              : undefined
          }
        >
          <Text
            style={[
              styles.btnText,
              { color: ready ? colors.primaryForeground : colors.mutedForeground },
            ]}
          >
            {submitting ? "Saving..." : submitLabel}
          </Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function FieldRenderer({
  field,
  value,
  onChange,
  onBlur,
  allValues,
  errorText,
}: {
  field: IntakeField;
  value: unknown;
  onChange: (v: unknown) => void;
  onBlur: () => void;
  allValues: Record<string, unknown>;
  errorText: string | null;
}) {
  const colors = useColors();
  const inputBorder = errorText ? ERROR_COLOR : colors.border;
  const wrapBorder = errorText ? ERROR_COLOR : "transparent";

  return (
    <View style={styles.field}>
      <View style={styles.labelRow}>
        <Text style={[styles.label, { color: colors.foreground }]}>{field.label}</Text>
        {field.required ? (
          <Text style={[styles.requiredTag, { color: ERROR_COLOR }]}>Required</Text>
        ) : null}
      </View>
      {field.helper ? (
        <Text style={[styles.helper, { color: colors.mutedForeground }]}>{field.helper}</Text>
      ) : null}

      {field.kind === "text" && (
        <TextInput
          style={[
            styles.input,
            {
              backgroundColor: colors.card,
              borderColor: inputBorder,
              color: colors.foreground,
            },
          ]}
          value={typeof value === "string" ? value : ""}
          placeholder={field.placeholder}
          placeholderTextColor={colors.mutedForeground}
          maxLength={field.maxLength}
          onChangeText={onChange}
          onBlur={onBlur}
          autoCapitalize="words"
          autoCorrect={false}
        />
      )}

      {field.kind === "longtext" && (
        <TextInput
          style={[
            styles.input,
            styles.longInput,
            {
              backgroundColor: colors.card,
              borderColor: inputBorder,
              color: colors.foreground,
            },
          ]}
          value={typeof value === "string" ? value : ""}
          placeholder={field.placeholder}
          placeholderTextColor={colors.mutedForeground}
          maxLength={field.maxLength}
          onChangeText={onChange}
          onBlur={onBlur}
          multiline
          textAlignVertical="top"
        />
      )}

      {field.kind === "single-select" && (
        <View
          style={[
            styles.optionsWrap,
            errorText
              ? { borderColor: wrapBorder, borderWidth: 1, borderRadius: 12, padding: 6 }
              : null,
          ]}
        >
          <View style={styles.options}>
            {(field.options ?? []).map((opt) => {
              const selected = value === opt.value;
              return (
                <Pressable
                  key={opt.value}
                  onPress={() => onChange(opt.value)}
                  style={[
                    styles.option,
                    {
                      backgroundColor: selected ? colors.primary : colors.card,
                      borderColor: selected ? colors.primary : colors.border,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.optionText,
                      { color: selected ? colors.primaryForeground : colors.foreground },
                    ]}
                  >
                    {opt.label}
                    {opt.sublabel ? (
                      <Text
                        style={{
                          color: selected
                            ? colors.primaryForeground + "B3"
                            : colors.mutedForeground,
                        }}
                      >
                        {" "}{opt.sublabel}
                      </Text>
                    ) : null}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      )}

      {field.kind === "zip" && (
        <TextInput
          style={[
            styles.input,
            {
              backgroundColor: colors.card,
              borderColor: inputBorder,
              color: colors.foreground,
              letterSpacing: 1,
            },
          ]}
          value={typeof value === "string" ? value : ""}
          placeholder={field.placeholder}
          placeholderTextColor={colors.mutedForeground}
          keyboardType="number-pad"
          maxLength={5}
          onChangeText={(t) => onChange(t.replace(/[^\d]/g, "").slice(0, 5))}
          onBlur={onBlur}
          autoCorrect={false}
        />
      )}

      {field.kind === "address" && (
        <AddressAutocompleteInput
          value={typeof value === "string" ? value : ""}
          onChangeText={(t) => onChange(t)}
          onPickPlace={(p) => onChange(p.formattedAddress)}
          placeholder={field.placeholder}
          returnKeyType="done"
          errorBorderColor={errorText ? ERROR_COLOR : undefined}
          onBlur={onBlur}
        />
      )}

      {field.kind === "zip-list" && (
        <View
          style={
            errorText
              ? { borderColor: wrapBorder, borderWidth: 1, borderRadius: 12, padding: 8 }
              : null
          }
        >
          <ZipPicker
            primaryZip={typeof allValues.primaryZip === "string" ? allValues.primaryZip : ""}
            value={Array.isArray(value) ? (value as string[]) : []}
            onChange={onChange}
          />
        </View>
      )}

      {field.kind === "multi-select" && (
        <View
          style={[
            styles.optionsWrap,
            errorText
              ? { borderColor: wrapBorder, borderWidth: 1, borderRadius: 12, padding: 6 }
              : null,
          ]}
        >
          <View style={styles.options}>
            {(field.options ?? []).map((opt) => {
              const arr = Array.isArray(value) ? (value as string[]) : [];
              const selected = arr.includes(opt.value);
              const toggle = () => {
                if (selected) onChange(arr.filter((v) => v !== opt.value));
                else onChange([...arr, opt.value]);
              };
              return (
                <Pressable
                  key={opt.value}
                  onPress={toggle}
                  style={[
                    styles.option,
                    {
                      backgroundColor: selected ? colors.primary : colors.card,
                      borderColor: selected ? colors.primary : colors.border,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.optionText,
                      { color: selected ? colors.primaryForeground : colors.foreground },
                    ]}
                  >
                    {opt.label}
                    {opt.sublabel ? (
                      <Text
                        style={{
                          color: selected
                            ? colors.primaryForeground + "B3"
                            : colors.mutedForeground,
                        }}
                      >
                        {" "}{opt.sublabel}
                      </Text>
                    ) : null}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      )}

      {errorText ? (
        <Text style={[styles.helper, { color: ERROR_COLOR }]}>{errorText}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 8,
  },
  headerBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  headerTitle: {
    flex: 1,
    textAlign: "center",
    fontSize: 16,
    fontFamily: "Inter_600SemiBold",
  },
  scroll: { paddingHorizontal: 24, gap: 16 },
  title: { fontSize: 26, fontFamily: "Inter_700Bold" },
  intro: { fontSize: 14, fontFamily: "Inter_400Regular", lineHeight: 20, marginBottom: 8 },
  fields: { gap: 18 },
  field: { gap: 8 },
  labelRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  label: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  requiredTag: { fontSize: 11, fontFamily: "Inter_700Bold", letterSpacing: 0.4 },
  helper: { fontSize: 12, fontFamily: "Inter_400Regular" },
  input: {
    height: 50,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 14,
    fontSize: 15,
    fontFamily: "Inter_400Regular",
  },
  longInput: { height: 100, paddingTop: 12, paddingBottom: 12 },
  optionsWrap: {},
  options: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  option: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 999,
    borderWidth: 1,
  },
  optionText: { fontSize: 13, fontFamily: "Inter_500Medium" },
  error: { fontSize: 13, fontFamily: "Inter_400Regular" },
  summary: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    marginTop: 4,
  },
  summaryText: { flex: 1, fontSize: 13, fontFamily: "Inter_500Medium", lineHeight: 18 },
  btn: { height: 52, borderRadius: 14, alignItems: "center", justifyContent: "center", marginTop: 8 },
  btnText: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
});
