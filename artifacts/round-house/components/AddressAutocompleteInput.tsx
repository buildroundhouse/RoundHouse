import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";

export type PickedLocation = { lat: number; lng: number };

export interface PickedPlace {
  placeId: string;
  formattedAddress: string;
  latitude: number | null;
  longitude: number | null;
}

type Props = {
  value: string;
  onChangeText: (text: string) => void;
  onPickPlace?: (place: PickedPlace) => void;
  placeholder?: string;
  returnKeyType?: "done" | "next";
  onLocationPicked?: (loc: PickedLocation | null) => void;
  errorBorderColor?: string;
  onBlur?: () => void;
};

const PLACES_API_KEY = process.env.EXPO_PUBLIC_GOOGLE_PLACES_API_KEY;
const AUTOCOMPLETE_ENDPOINT =
  "https://places.googleapis.com/v1/places:autocomplete";
const DETAILS_ENDPOINT_BASE = "https://places.googleapis.com/v1/places";

// Subset of the Places Autocomplete (New) response we care about.
interface PlacesTextField {
  text?: string;
}
interface PlacesStructuredFormat {
  mainText?: PlacesTextField;
  secondaryText?: PlacesTextField;
}
interface PlacePrediction {
  placeId?: string;
  text?: PlacesTextField;
  structuredFormat?: PlacesStructuredFormat;
}
interface AutocompleteSuggestion {
  placePrediction?: PlacePrediction;
}
interface AutocompleteResponse {
  suggestions?: AutocompleteSuggestion[];
}
interface PlaceLocation {
  latitude?: number;
  longitude?: number;
}
interface PlaceDetailsResponse {
  formattedAddress?: string;
  location?: PlaceLocation;
}

type Suggestion = { placeId: string; text: string };

function generateSessionToken(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function predictionToSuggestion(p: PlacePrediction): Suggestion | null {
  const placeId = p.placeId;
  if (!placeId) return null;
  const main = p.structuredFormat?.mainText?.text;
  const secondary = p.structuredFormat?.secondaryText?.text;
  const text =
    main && secondary ? `${main}, ${secondary}` : p.text?.text ?? "";
  if (!text) return null;
  return { placeId, text };
}

export function AddressAutocompleteInput({
  value,
  onChangeText,
  onPickPlace,
  placeholder,
  returnKeyType,
  onLocationPicked,
  errorBorderColor,
  onBlur,
}: Props) {
  const colors = useColors();
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [resolvingDetails, setResolvingDetails] = useState(false);
  const [focused, setFocused] = useState(false);
  // Counts consecutive failures; we only disable the dropdown for the rest of
  // the session after several in a row, so a single blip doesn't break it.
  const [failureCount, setFailureCount] = useState(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const blurTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sessionTokenRef = useRef<string>(generateSessionToken());
  const lastQueryRef = useRef<string>("");
  const justPickedRef = useRef<boolean>(false);
  const inflightAbortRef = useRef<AbortController | null>(null);
  // Monotonic counter to ignore out-of-order responses if abort isn't honored.
  const requestSeqRef = useRef<number>(0);

  const autocompleteEnabled = !!PLACES_API_KEY && failureCount < 3;

  useEffect(() => {
    if (!autocompleteEnabled) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (justPickedRef.current) {
      justPickedRef.current = false;
      return;
    }
    // Don't fetch suggestions for prefilled values that the user hasn't
    // engaged with yet (e.g. opening the Edit modal).
    if (!focused) return;
    const q = value.trim();
    if (q.length < 3) {
      setSuggestions([]);
      lastQueryRef.current = "";
      return;
    }
    if (q === lastQueryRef.current) return;
    debounceRef.current = setTimeout(() => {
      void fetchSuggestions(q);
    }, 350);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [value, autocompleteEnabled, focused]);

  useEffect(() => {
    return () => {
      if (blurTimerRef.current) clearTimeout(blurTimerRef.current);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (inflightAbortRef.current) inflightAbortRef.current.abort();
    };
  }, []);

  async function fetchSuggestions(q: string) {
    if (!PLACES_API_KEY) return;
    // Abort any in-flight request so its response can't overwrite a newer one.
    if (inflightAbortRef.current) inflightAbortRef.current.abort();
    const controller = new AbortController();
    inflightAbortRef.current = controller;
    const seq = ++requestSeqRef.current;
    setLoading(true);
    lastQueryRef.current = q;
    try {
      const res = await fetch(AUTOCOMPLETE_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": PLACES_API_KEY,
        },
        body: JSON.stringify({
          input: q,
          sessionToken: sessionTokenRef.current,
        }),
        signal: controller.signal,
      });
      if (seq !== requestSeqRef.current) return; // a newer request started
      if (!res.ok) {
        setFailureCount((n) => n + 1);
        setSuggestions([]);
        return;
      }
      const data = (await res.json()) as AutocompleteResponse;
      if (seq !== requestSeqRef.current) return;
      const items: Suggestion[] = (data.suggestions ?? [])
        .map((s) => s.placePrediction)
        .filter((p): p is PlacePrediction => !!p)
        .map(predictionToSuggestion)
        .filter((s): s is Suggestion => s !== null)
        .slice(0, 5);
      setSuggestions(items);
      setFailureCount(0);
    } catch (e) {
      // AbortError is expected when a newer request supersedes this one.
      if (e instanceof Error && e.name === "AbortError") return;
      setFailureCount((n) => n + 1);
      setSuggestions([]);
    } finally {
      if (seq === requestSeqRef.current) setLoading(false);
    }
  }

  async function fetchPlaceDetails(
    placeId: string,
  ): Promise<PlaceDetailsResponse | null> {
    if (!PLACES_API_KEY) return null;
    try {
      const res = await fetch(
        `${DETAILS_ENDPOINT_BASE}/${encodeURIComponent(placeId)}`,
        {
          method: "GET",
          headers: {
            "X-Goog-Api-Key": PLACES_API_KEY,
            "X-Goog-FieldMask": "formattedAddress,location",
          },
        },
      );
      if (!res.ok) return null;
      return (await res.json()) as PlaceDetailsResponse;
    } catch {
      return null;
    }
  }

  async function pick(s: Suggestion) {
    justPickedRef.current = true;
    // Optimistically fill the field with the prediction text so the dropdown
    // can close immediately even if the details request is slow.
    lastQueryRef.current = s.text.trim();
    onChangeText(s.text);
    setSuggestions([]);
    setFocused(false);
    setResolvingDetails(true);
    try {
      const details = await fetchPlaceDetails(s.placeId);
      const formatted = details?.formattedAddress ?? null;
      const finalText = formatted ?? s.text;
      if (formatted && formatted !== s.text) {
        justPickedRef.current = true;
        lastQueryRef.current = formatted.trim();
        onChangeText(formatted);
      }
      const lat = details?.location?.latitude;
      const lng = details?.location?.longitude;

      if (typeof lat === "number" && typeof lng === "number") {
        onLocationPicked?.({ lat, lng });
      } else {
        onLocationPicked?.(null);
      }

      if (onPickPlace) {
        onPickPlace({
          placeId: s.placeId,
          formattedAddress: finalText,
          latitude: typeof lat === "number" ? lat : null,
          longitude: typeof lng === "number" ? lng : null,
        });
      }
    } finally {
      setResolvingDetails(false);
      // Place Details closes the autocomplete session for billing — start fresh.
      sessionTokenRef.current = generateSessionToken();
    }
  }

  const showDropdown =
    focused && autocompleteEnabled && (suggestions.length > 0 || loading);

  return (
    <View style={styles.wrap}>
      <TextInput
        style={[
          styles.input,
          {
            backgroundColor: colors.card,
            borderColor: errorBorderColor ?? colors.border,
            color: colors.foreground,
          },
        ]}
        placeholder={placeholder}
        placeholderTextColor={colors.mutedForeground}
        value={value}
        onChangeText={onChangeText}
        onFocus={() => {
          if (blurTimerRef.current) clearTimeout(blurTimerRef.current);
          setFocused(true);
        }}
        onBlur={() => {
          // Delay so a tap on a suggestion can fire before we hide the dropdown.
          blurTimerRef.current = setTimeout(() => setFocused(false), 150);
          onBlur?.();
        }}
        autoCorrect={false}
        autoCapitalize="words"
        returnKeyType={returnKeyType}
      />
      {resolvingDetails ? (
        <View style={styles.inlineSpinner}>
          <ActivityIndicator size="small" color={colors.mutedForeground} />
        </View>
      ) : null}
      {showDropdown ? (
        <View
          style={[
            styles.dropdown,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          {loading && suggestions.length === 0 ? (
            <View style={styles.loadingRow}>
              <ActivityIndicator size="small" color={colors.mutedForeground} />
            </View>
          ) : null}
          {suggestions.map((s, idx) => (
            <Pressable
              key={`${s.placeId}-${idx}`}
              onPress={() => {
                void pick(s);
              }}
              style={({ pressed }) => [
                styles.row,
                {
                  opacity: pressed ? 0.6 : 1,
                  borderBottomColor: colors.border,
                  borderBottomWidth:
                    idx === suggestions.length - 1
                      ? 0
                      : StyleSheet.hairlineWidth,
                },
              ]}
            >
              <Feather name="map-pin" size={14} color={colors.mutedForeground} />
              <Text
                style={[styles.rowText, { color: colors.foreground }]}
                numberOfLines={2}
              >
                {s.text}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: "relative", zIndex: 10 },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    fontFamily: "Inter_400Regular",
  },
  inlineSpinner: {
    position: "absolute",
    right: 12,
    top: 14,
  },
  dropdown: {
    position: "absolute",
    top: 50,
    left: 0,
    right: 0,
    borderWidth: 1,
    borderRadius: 10,
    overflow: "hidden",
    zIndex: 20,
    elevation: 6,
    shadowColor: "#000",
    shadowOpacity: 0.12,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  rowText: { flex: 1, fontSize: 14, fontFamily: "Inter_400Regular" },
  loadingRow: { paddingVertical: 14, alignItems: "center" },
});
