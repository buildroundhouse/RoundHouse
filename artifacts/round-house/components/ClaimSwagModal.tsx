import React from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { useClaimSwag } from "@workspace/api-client-react";

interface Props {
  visible: boolean;
  defaultName?: string;
  onClose: () => void;
  onSuccess: () => void;
}

export function ClaimSwagModal({ visible, defaultName, onClose, onSuccess }: Props) {
  const colors = useColors();
  const claim = useClaimSwag();
  const [name, setName] = React.useState(defaultName ?? "");
  const [street, setStreet] = React.useState("");
  const [city, setCity] = React.useState("");
  const [state, setState] = React.useState("");
  const [zip, setZip] = React.useState("");

  React.useEffect(() => {
    if (visible) setName(defaultName ?? "");
  }, [visible, defaultName]);

  const submit = async () => {
    try {
      await claim.mutateAsync({
        data: {
          name: name.trim(),
          street: street.trim(),
          city: city.trim(),
          state: state.trim().toUpperCase(),
          zip: zip.trim(),
        },
      });
      onSuccess();
      onClose();
      setStreet("");
      setCity("");
      setState("");
      setZip("");
    } catch (err: unknown) {
      const message =
        err && typeof err === "object" && "message" in err
          ? String((err as { message: unknown }).message)
          : "Could not submit swag claim";
      Alert.alert("Swag claim failed", message);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={[styles.scrim, { backgroundColor: "rgba(0,0,0,0.4)" }]}>
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={[styles.sheet, { backgroundColor: colors.background }]}
        >
          <View style={styles.header}>
            <Pressable onPress={onClose} hitSlop={10}>
              <Feather name="x" size={22} color={colors.foreground} />
            </Pressable>
            <Text style={[styles.title, { color: colors.foreground }]}>Claim swag</Text>
            <View style={{ width: 22 }} />
          </View>
          <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
            <Text style={[styles.body, { color: colors.mutedForeground }]}>
              Tell us where to ship your Roundhouse swag. We&apos;ll send you a tracking
              link by email.
            </Text>
            <Field label="Full name" value={name} onChangeText={setName} colors={colors} />
            <Field label="Street" value={street} onChangeText={setStreet} colors={colors} />
            <Field label="City" value={city} onChangeText={setCity} colors={colors} />
            <View style={{ flexDirection: "row", gap: 12 }}>
              <View style={{ flex: 1 }}>
                <Field
                  label="State"
                  value={state}
                  onChangeText={setState}
                  colors={colors}
                  autoCapitalize="characters"
                  maxLength={2}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Field
                  label="ZIP"
                  value={zip}
                  onChangeText={setZip}
                  colors={colors}
                  keyboardType="number-pad"
                  maxLength={10}
                />
              </View>
            </View>
            <Pressable
              onPress={submit}
              disabled={claim.isPending || !name || !street || !city || !state || !zip}
              style={[
                styles.cta,
                {
                  backgroundColor: colors.foreground,
                  opacity:
                    claim.isPending || !name || !street || !city || !state || !zip
                      ? 0.5
                      : 1,
                },
              ]}
            >
              <Text style={[styles.ctaText, { color: colors.background }]}>
                {claim.isPending ? "Submitting…" : "Submit claim"}
              </Text>
            </Pressable>
          </ScrollView>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

interface FieldProps {
  label: string;
  value: string;
  onChangeText: (t: string) => void;
  colors: ReturnType<typeof useColors>;
  autoCapitalize?: "none" | "sentences" | "words" | "characters";
  keyboardType?: "default" | "number-pad";
  maxLength?: number;
}

function Field({ label, value, onChangeText, colors, ...rest }: FieldProps) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        style={[
          styles.input,
          {
            backgroundColor: colors.card,
            borderColor: colors.border,
            color: colors.foreground,
          },
        ]}
        placeholderTextColor={colors.mutedForeground}
        {...rest}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, justifyContent: "flex-end" },
  sheet: { borderTopLeftRadius: 18, borderTopRightRadius: 18, maxHeight: "92%" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(0,0,0,0.08)",
  },
  title: { fontFamily: "Inter_700Bold", fontSize: 16 },
  body: { fontFamily: "Inter_400Regular", fontSize: 13 },
  fieldLabel: { fontFamily: "Inter_600SemiBold", fontSize: 12, textTransform: "uppercase" },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontFamily: "Inter_500Medium",
    fontSize: 14,
  },
  cta: { borderRadius: 12, paddingVertical: 14, alignItems: "center", marginTop: 8 },
  ctaText: { fontFamily: "Inter_700Bold", fontSize: 15 },
});
