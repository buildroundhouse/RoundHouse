import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useColors } from "@/hooks/useColors";
import {
  US_STATES,
  findPropertyAddresses,
  formatPropertyAddress,
  type PropertyAddress,
} from "@/lib/property-address";

export function PropertyAddressCard({
  value,
  onChange,
}: {
  value: PropertyAddress;
  onChange: (value: PropertyAddress) => void;
}) {
  const colors = useColors();
  const [statesOpen, setStatesOpen] = useState(false);
  const [matches, setMatches] = useState<PropertyAddress[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [retry, setRetry] = useState(0);
  const generation = useRef(0);
  const currentRequest = useRef<AbortController | null>(null);
  const stopLookup = () => {
    generation.current++;
    currentRequest.current?.abort();
    setMatches([]);
    setLoading(false);
  };
  const edit = (
    key: "street" | "unit" | "city" | "state" | "zip",
    text: string,
  ) => {
    stopLookup();
    setMessage("");
    onChange({
      ...value,
      [key]: text,
      ...(key === "street" || key === "city" || key === "state"
        ? { zip: "" }
        : {}),
      status: "unchecked",
      placeId: null,
      latitude: null,
      longitude: null,
    });
  };

  useEffect(() => {
    if (
      !value.street.trim() ||
      !value.city.trim() ||
      !value.state ||
      value.status !== "unchecked"
    )
      return;
    const seq = ++generation.current;
    const controller = new AbortController();
    currentRequest.current = controller;
    const timer = setTimeout(async () => {
      setLoading(true);
      setMessage("");
      const timeout = setTimeout(() => controller.abort(), 10000);
      try {
        const found = await findPropertyAddresses(
          value,
          process.env.EXPO_PUBLIC_GOOGLE_PLACES_API_KEY,
          controller.signal,
        );
        if (seq !== generation.current) return;
        setMatches(found);
        setMessage(
          found.length
            ? "Select your address below to fill the ZIP Code."
            : "No complete address match found. Check the street, city and state, or enter the ZIP Code manually.",
        );
      } catch (error) {
        if (seq !== generation.current) return;
        setMessage(
          controller.signal.aborted
            ? "Address lookup timed out. Retry or enter the ZIP Code manually."
            : error instanceof Error
              ? error.message
              : "Address lookup failed. Please retry.",
        );
      } finally {
        clearTimeout(timeout);
        if (seq === generation.current) setLoading(false);
      }
    }, 650);
    return () => {
      clearTimeout(timer);
      generation.current++;
      controller.abort();
    };
  }, [value.street, value.unit, value.city, value.state, value.status, retry]);

  const labelStyle = {
    color: colors.foreground,
    fontSize: 14,
    fontWeight: "600" as const,
  };
  const field = (
    label: string,
    key: "street" | "unit" | "city" | "zip",
    placeholder: string,
  ) => (
    <View style={styles.field}>
      <Text style={labelStyle}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        value={value[key]}
        onChangeText={(text) =>
          edit(
            key,
            key === "zip" ? text.replace(/[^\d-]/g, "").slice(0, 10) : text,
          )
        }
        placeholder={placeholder}
        placeholderTextColor={colors.mutedForeground}
        keyboardType={key === "zip" ? "numbers-and-punctuation" : "default"}
        autoCapitalize="words"
        autoCorrect={false}
        maxLength={key === "zip" ? 10 : 160}
        style={[
          styles.input,
          {
            borderColor: colors.border,
            color: colors.foreground,
            backgroundColor: colors.background,
          },
        ]}
      />
    </View>
  );
  return (
    <View
      style={[
        styles.card,
        { backgroundColor: colors.card, borderColor: colors.border },
      ]}
    >
      <Text style={[labelStyle, { fontSize: 20 }]}>Property address</Text>
      {field("Street address", "street", "123 Main Street")}
      {field("Apartment / unit (optional)", "unit", "Unit 2")}
      {field("City", "city", "Austin")}
      <View style={styles.field}>
        <Text style={labelStyle}>State</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Choose state"
          onPress={() => setStatesOpen(true)}
          style={[
            styles.input,
            { borderColor: colors.border, backgroundColor: colors.background },
          ]}
        >
          <Text style={{ color: colors.foreground }}>
            {US_STATES.find(([code]) => code === value.state)?.[1] ??
              "Choose a state"}{" "}
            ▾
          </Text>
        </Pressable>
      </View>
      {field("ZIP Code", "zip", "Filled from your address match")}
      {loading ? (
        <ActivityIndicator
          accessibilityLabel="Looking up address"
          color={colors.primary}
        />
      ) : null}
      {message && value.status === "unchecked" ? (
        <Text
          accessibilityLiveRegion="polite"
          style={{ color: colors.mutedForeground }}
        >
          {message}
        </Text>
      ) : null}
      {matches.map((match) => (
        <Pressable
          key={match.placeId}
          accessibilityRole="button"
          onPress={() => {
            stopLookup();
            setMessage("");
            onChange({ ...match, unit: value.unit });
          }}
          style={[styles.input, { borderColor: colors.primary }]}
        >
          <Text style={{ color: colors.foreground }}>
            {formatPropertyAddress(match)}
          </Text>
          <Text style={{ color: colors.primary }}>Use this address</Text>
        </Pressable>
      ))}
      {value.status === "unchecked" &&
      value.street.trim() &&
      value.city.trim() &&
      value.state ? (
        <>
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              stopLookup();
              setRetry((n) => n + 1);
            }}
          >
            <Text style={{ color: colors.primary }}>Retry address lookup</Text>
          </Pressable>
          {/^\d{5}(-\d{4})?$/.test(value.zip.trim()) ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                stopLookup();
                onChange({
                  ...value,
                  status: "manual",
                  placeId: null,
                  latitude: null,
                  longitude: null,
                });
              }}
            >
              <Text style={{ color: colors.primary }}>
                Use manually entered address
              </Text>
            </Pressable>
          ) : null}
        </>
      ) : null}
      <Text
        accessibilityLiveRegion="polite"
        style={{ color: colors.mutedForeground }}
      >
        {value.status === "matched"
          ? "Address matched. This does not verify residency, ownership, or the apartment/unit."
          : value.status === "manual"
            ? "Address entered manually — not checked against address records."
            : "ZIP Code comes from a matched address; it is never guessed from the city alone."}
      </Text>
      <Modal
        visible={statesOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setStatesOpen(false)}
      >
        <View style={styles.overlay}>
          <View style={[styles.picker, { backgroundColor: colors.card }]}>
            <Text style={[labelStyle, { fontSize: 20 }]}>Choose state</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close state selector"
              onPress={() => setStatesOpen(false)}
            >
              <Text style={{ color: colors.primary }}>Cancel</Text>
            </Pressable>
            <ScrollView keyboardShouldPersistTaps="handled">
              {US_STATES.map(([code, name]) => (
                <Pressable
                  key={code}
                  accessibilityRole="button"
                  accessibilityState={{ selected: value.state === code }}
                  onPress={() => {
                    edit("state", code);
                    setStatesOpen(false);
                  }}
                  style={styles.state}
                >
                  <Text style={{ color: colors.foreground }}>
                    {name} ({code})
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}
const styles = StyleSheet.create({
  card: { padding: 18, borderRadius: 16, borderWidth: 1, gap: 14 },
  field: { gap: 7 },
  input: {
    minHeight: 48,
    padding: 12,
    borderWidth: 1,
    borderRadius: 10,
    justifyContent: "center",
  },
  overlay: {
    flex: 1,
    backgroundColor: "#0008",
    justifyContent: "center",
    padding: 24,
  },
  picker: { maxHeight: "80%", padding: 20, borderRadius: 16, gap: 12 },
  state: { paddingVertical: 14 },
});
