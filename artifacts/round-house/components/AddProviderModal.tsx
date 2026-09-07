import React, { useState } from "react";
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useColors } from "@/hooks/useColors";

const TRADE_OPTIONS = [
  "Plumber",
  "Electrician",
  "HVAC",
  "Pool Tech",
  "Handyman",
  "Landscaper",
  "Cleaner",
  "Painter",
  "Roofer",
  "Pest Control",
  "Other",
];

interface Props {
  visible: boolean;
  onClose: () => void;
  onSubmit: (data: {
    email: string;
    role: string;
    tradeType?: string;
    companyName?: string;
    phone?: string;
    licenseNumber?: string;
  }) => Promise<void>;
}

export function AddProviderModal({ visible, onClose, onSubmit }: Props) {
  const colors = useColors();
  const [email, setEmail] = useState("");
  const [tradeType, setTradeType] = useState<string>("");
  const [companyName, setCompanyName] = useState("");
  const [phone, setPhone] = useState("");
  const [licenseNumber, setLicenseNumber] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setEmail("");
    setTradeType("");
    setCompanyName("");
    setPhone("");
    setLicenseNumber("");
    setError(null);
  };

  const handleSubmit = async () => {
    if (!email.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit({
        email: email.trim(),
        role: "member",
        tradeType: tradeType || undefined,
        companyName: companyName.trim() || undefined,
        phone: phone.trim() || undefined,
        licenseNumber: licenseNumber.trim() || undefined,
      });
      reset();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not add provider");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={[styles.container, { backgroundColor: colors.background }]}
      >
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <TouchableOpacity onPress={onClose}>
            <Text style={[styles.cancel, { color: colors.mutedForeground }]}>Cancel</Text>
          </TouchableOpacity>
          <Text style={[styles.title, { color: colors.foreground }]}>Invite to Property</Text>
          <TouchableOpacity
            onPress={handleSubmit}
            disabled={!email.trim() || submitting}
            style={[
              styles.saveBtn,
              { backgroundColor: email.trim() ? colors.primary : colors.muted },
            ]}
          >
            <Text
              style={[
                styles.saveText,
                { color: email.trim() ? colors.primaryForeground : colors.mutedForeground },
              ]}
            >
              Save
            </Text>
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          {error ? (
            <Text style={[styles.error, { color: colors.destructive }]}>{error}</Text>
          ) : null}
          <Text style={[styles.label, { color: colors.mutedForeground }]}>EMAIL</Text>
          <TextInput
            value={email}
            onChangeText={setEmail}
            placeholder="provider@example.com"
            placeholderTextColor={colors.mutedForeground}
            autoCapitalize="none"
            keyboardType="email-address"
            style={[styles.input, { color: colors.foreground, backgroundColor: colors.card, borderColor: colors.border }]}
          />

          <Text style={[styles.label, { color: colors.mutedForeground }]}>TRADE</Text>
          <View style={styles.chipWrap}>
            {TRADE_OPTIONS.map((t) => {
              const sel = tradeType === t;
              return (
                <TouchableOpacity
                  key={t}
                  onPress={() => setTradeType(sel ? "" : t)}
                  style={[
                    styles.chip,
                    {
                      backgroundColor: sel ? colors.primary : colors.card,
                      borderColor: sel ? colors.primary : colors.border,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.chipText,
                      { color: sel ? colors.primaryForeground : colors.foreground },
                    ]}
                  >
                    {t}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <Text style={[styles.label, { color: colors.mutedForeground }]}>COMPANY (optional)</Text>
          <TextInput
            value={companyName}
            onChangeText={setCompanyName}
            placeholder="ACME Plumbing"
            placeholderTextColor={colors.mutedForeground}
            style={[styles.input, { color: colors.foreground, backgroundColor: colors.card, borderColor: colors.border }]}
          />

          <Text style={[styles.label, { color: colors.mutedForeground }]}>PHONE (optional)</Text>
          <TextInput
            value={phone}
            onChangeText={setPhone}
            placeholder="(555) 555-1234"
            placeholderTextColor={colors.mutedForeground}
            keyboardType="phone-pad"
            style={[styles.input, { color: colors.foreground, backgroundColor: colors.card, borderColor: colors.border }]}
          />

          <Text style={[styles.label, { color: colors.mutedForeground }]}>LICENSE # (optional)</Text>
          <TextInput
            value={licenseNumber}
            onChangeText={setLicenseNumber}
            placeholder="License or cert number"
            placeholderTextColor={colors.mutedForeground}
            style={[styles.input, { color: colors.foreground, backgroundColor: colors.card, borderColor: colors.border }]}
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  cancel: { fontSize: 16, fontFamily: "Inter_400Regular" },
  title: { fontSize: 17, fontFamily: "Inter_600SemiBold" },
  saveBtn: { paddingHorizontal: 16, paddingVertical: 7, borderRadius: 18 },
  saveText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  body: { padding: 20, gap: 8, paddingBottom: 80 },
  label: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 0.7,
    marginTop: 14,
    marginBottom: 6,
  },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 15,
    fontFamily: "Inter_400Regular",
  },
  chipWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 18,
    borderWidth: 1,
  },
  chipText: { fontSize: 13, fontFamily: "Inter_500Medium" },
  error: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
    padding: 10,
    borderRadius: 8,
  },
});
