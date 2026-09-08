import React, { useMemo, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";

const BUSINESS_TYPES = [
  "Architect",
  "Carpenter",
  "Cleaning / Housekeeping",
  "Concrete Contractor",
  "Decorator",
  "Design-Build Contractor",
  "Designer",
  "Drywall Contractor",
  "Electrician",
  "Flooring Contractor",
  "General Contractor",
  "Handyman",
  "HVAC Contractor",
  "Interior Designer",
  "Landscaper",
  "Lawn Care",
  "Masonry Contractor",
  "Painter",
  "Plumber",
  "Property Maintenance",
  "Remodeling Contractor",
  "Restoration Contractor",
  "Roofer",
  "Tile Contractor",
  "Window / Door Contractor",
];

type Form = {
  businessName: string;
  businessType: string;
  phone: string;
  zip: string;
  streetAddress: string;
  website: string;
  instagram: string;
  employees: string;
  yearsInBusiness: string;
  specialties: string;
};

export default function EntryBusinessScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { name } = useLocalSearchParams<{ name?: string }>();
  const [showTypes, setShowTypes] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [form, setForm] = useState<Form>({
    businessName: typeof name === "string" ? name : "",
    businessType: "",
    phone: "",
    zip: "",
    streetAddress: "",
    website: "",
    instagram: "",
    employees: "",
    yearsInBusiness: "",
    specialties: "",
  });

  const set = (key: keyof Form) => (value: string) => {
    setForm((current) => ({ ...current, [key]: value }));
    setSubmitted(false);
  };

  const missing = useMemo(() => {
    const fields: string[] = [];
    if (!form.businessName.trim()) fields.push("Business name");
    if (!form.phone.trim()) fields.push("Phone number");
    if (!/^\d{5}$/.test(form.zip.trim())) fields.push("ZIP Code");
    return fields;
  }, [form]);

  const submit = () => {
    setSubmitted(true);
    if (missing.length) return;
    // Front-first only. Persistence will be attached to the new entity API,
    // not the legacy mode/intake system.
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={[styles.root, { backgroundColor: colors.background }]}>
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 32 }]}
        keyboardShouldPersistTaps="handled"
      >
        <Pressable onPress={() => router.back()} style={styles.back} hitSlop={12}>
          <Feather name="chevron-left" size={22} color={colors.foreground} />
          <Text style={[styles.backText, { color: colors.foreground }]}>Back</Text>
        </Pressable>

        <Text style={[styles.title, { color: colors.foreground }]}>Add business</Text>
        <Text style={[styles.intro, { color: colors.mutedForeground }]}>Start with the basics. You can complete the rest now or later.</Text>

        <Field label="Business name" required value={form.businessName} onChange={set("businessName")} placeholder="DMT DESIGN BUILD" colors={colors} error={submitted && !form.businessName.trim()} />

        <View style={styles.field}>
          <Text style={[styles.label, { color: colors.foreground }]}>Business type</Text>
          <TextInput
            value={form.businessType}
            onChangeText={set("businessType")}
            placeholder="Handyman, contractor, designer..."
            placeholderTextColor={colors.mutedForeground}
            style={[styles.input, { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground }]}
            autoCapitalize="words"
          />
          <Pressable onPress={() => setShowTypes((value) => !value)} style={styles.typeToggle}>
            <Text style={[styles.typeToggleText, { color: colors.primary }]}>{showTypes ? "Hide common types" : "Choose from common types"}</Text>
            <Feather name={showTypes ? "chevron-up" : "chevron-down"} size={17} color={colors.primary} />
          </Pressable>
          {showTypes ? (
            <View style={styles.chips}>
              {BUSINESS_TYPES.map((type) => {
                const selected = form.businessType === type;
                return (
                  <Pressable
                    key={type}
                    onPress={() => { set("businessType")(type); setShowTypes(false); }}
                    style={[styles.chip, { backgroundColor: selected ? colors.primary : colors.card, borderColor: selected ? colors.primary : colors.border }]}
                  >
                    <Text style={[styles.chipText, { color: selected ? colors.primaryForeground : colors.foreground }]}>{type}</Text>
                  </Pressable>
                );
              })}
            </View>
          ) : null}
        </View>

        <Field label="Phone number" required value={form.phone} onChange={set("phone")} placeholder="(512) 555-0123" colors={colors} phone error={submitted && !form.phone.trim()} />
        <Field label="ZIP Code" required value={form.zip} onChange={(value) => set("zip")(value.replace(/[^\d]/g, "").slice(0, 5))} placeholder="78701" colors={colors} numeric error={submitted && !/^\d{5}$/.test(form.zip.trim())} />

        <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Business details</Text>
        <Text style={[styles.sectionIntro, { color: colors.mutedForeground }]}>Optional — these help people understand the business.</Text>

        <Field label="Street address" value={form.streetAddress} onChange={set("streetAddress")} placeholder="Street address" colors={colors} />
        <Field label="Website" value={form.website} onChange={set("website")} placeholder="www.example.com" colors={colors} lower />
        <Field label="Instagram" value={form.instagram} onChange={set("instagram")} placeholder="@businessname" colors={colors} lower />
        <Field label="Number of employees" value={form.employees} onChange={set("employees")} placeholder="5" colors={colors} numeric />
        <Field label="Years in business" value={form.yearsInBusiness} onChange={set("yearsInBusiness")} placeholder="12" colors={colors} numeric />

        <View style={styles.field}>
          <Text style={[styles.label, { color: colors.foreground }]}>Specialties</Text>
          <TextInput
            value={form.specialties}
            onChangeText={set("specialties")}
            placeholder="Custom millwork, remodeling, historic restoration..."
            placeholderTextColor={colors.mutedForeground}
            multiline
            textAlignVertical="top"
            style={[styles.input, styles.longInput, { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground }]}
          />
        </View>

        {submitted && missing.length ? (
          <View style={styles.errorRow}>
            <Feather name="alert-circle" size={16} color="#E55" />
            <Text style={styles.errorText}>Please complete: {missing.join(", ")}</Text>
          </View>
        ) : null}

        <Pressable onPress={submit} style={[styles.button, { backgroundColor: colors.primary }]}>
          <Text style={[styles.buttonText, { color: colors.primaryForeground }]}>Continue</Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Field({ label, required = false, value, onChange, placeholder, colors, phone = false, numeric = false, lower = false, error = false }: any) {
  return (
    <View style={styles.field}>
      <View style={styles.labelRow}>
        <Text style={[styles.label, { color: colors.foreground }]}>{label}</Text>
        {required ? <Text style={styles.required}>Required</Text> : null}
      </View>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={colors.mutedForeground}
        keyboardType={phone ? "phone-pad" : numeric ? "number-pad" : "default"}
        autoCapitalize={lower ? "none" : "words"}
        autoCorrect={false}
        style={[styles.input, { backgroundColor: colors.card, borderColor: error ? "#E55" : colors.border, color: colors.foreground }]}
      />
      {error ? <Text style={styles.errorText}>Required</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { paddingHorizontal: 24, gap: 18 },
  back: { flexDirection: "row", alignItems: "center", gap: 4, marginBottom: 4 },
  backText: { fontSize: 14, fontFamily: "Inter_500Medium" },
  title: { fontSize: 26, fontFamily: "Inter_700Bold" },
  intro: { fontSize: 14, lineHeight: 20, marginBottom: 4 },
  field: { gap: 8 },
  labelRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  label: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  required: { fontSize: 11, fontFamily: "Inter_700Bold", color: "#E55" },
  input: { minHeight: 50, borderRadius: 12, borderWidth: 1, paddingHorizontal: 14, fontSize: 15 },
  longInput: { minHeight: 100, paddingTop: 14, paddingBottom: 14 },
  typeToggle: { flexDirection: "row", alignItems: "center", gap: 5, alignSelf: "flex-start" },
  typeToggleText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8, paddingTop: 4 },
  chip: { borderWidth: 1, borderRadius: 18, paddingHorizontal: 11, paddingVertical: 8 },
  chipText: { fontSize: 12, fontFamily: "Inter_500Medium" },
  sectionTitle: { fontSize: 18, fontFamily: "Inter_700Bold", marginTop: 6 },
  sectionIntro: { fontSize: 13, lineHeight: 18, marginTop: -10 },
  errorRow: { flexDirection: "row", alignItems: "center", gap: 7 },
  errorText: { color: "#E55", fontSize: 12, lineHeight: 17 },
  button: { height: 52, borderRadius: 14, alignItems: "center", justifyContent: "center", marginTop: 4 },
  buttonText: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
});
