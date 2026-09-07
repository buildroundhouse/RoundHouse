import React, { useMemo, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Linking,
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
import { useQueryClient } from "@tanstack/react-query";
import {
  createAppInvite,
  getGetAppInviteShareContextQueryKey,
  useGetAppInviteShareContext,
  type UserModeKind,
} from "@workspace/api-client-react";
import { MODE_TAGLINES } from "@/lib/intake-schemas";
import { extractApiErrorMessage } from "@/lib/apiErrorMessage";
import {
  buildShareInviteLimitHint,
  computeShareInviteCanSubmit,
  isShareInviteLimitReached,
} from "@/lib/shareInviteLimit";
import { RisingSunSticker } from "./RisingSunSticker";
import { InviteSendOptions } from "./InviteSendOptions";

type SentInvite = {
  smsUri: string;
  smsBody: string;
  recipientName: string;
};

// Picker options shown in the share form. Mirrors the product copy in the
// task spec exactly — internal mode kinds like `trade_pro_collab` and
// `facilities_collab` are collapsed into a single "Collaborator" choice.
const PICKER_OPTIONS: { kind: UserModeKind; label: string }[] = [
  { kind: "home", label: "Home" },
  { kind: "home_teammate", label: "Home Teammate" },
  { kind: "trade_pro", label: "Trade Pro" },
  { kind: "trade_pro_teammate", label: "Trade Teammate" },
  { kind: "facilities", label: "Facility Management" },
  { kind: "facilities_teammate", label: "Facility Teammate" },
  { kind: "trade_pro_collab", label: "Collaborator" },
];

type Props = {
  visible: boolean;
  onClose: () => void;
  onSent: () => void;
  onEditProfile?: () => void;
};

export function ShareRoundHouseModal({ visible, onClose, onSent, onEditProfile }: Props) {
  const colors = useColors();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [kind, setKind] = useState<UserModeKind>("home");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Once the server records the invite, swap the form for the send-options
  // panel. Keeping the SMS launch out of the create flow sidesteps the
  // user-gesture-context loss after `await createAppInvite` (iOS Safari
  // silently blocks `sms:` programmatic navigation in that case) — the
  // panel re-prompts the user for a fresh tap.
  const [sent, setSent] = useState<SentInvite | null>(null);

  // Server tells us what placeholders the SMS template needs and which are
  // missing on this user's profile. Drives the inline hint above the form.
  // staleTime: 0 + refetchOnMount: "always" means a previously-cached
  // "limit reached" snapshot can't keep the CTA disabled after a sibling
  // action (resend, cancel, lazy expiry) frees up a daily-cap slot —
  // every reopen pulls a fresh dailyRemaining.
  const { data: shareCtx } = useGetAppInviteShareContext({
    query: {
      queryKey: getGetAppInviteShareContextQueryKey(),
      enabled: visible,
      staleTime: 0,
      refetchOnMount: "always",
    },
  });

  const reset = () => {
    setName("");
    setPhone("");
    setKind("home");
    setError(null);
    setSubmitting(false);
    setSent(null);
  };

  const close = () => {
    if (submitting) return;
    // If the user dismisses the modal while the success panel is showing,
    // still notify the parent so any "you have new sent invites" surfaces
    // refresh — the invite is real either way.
    if (sent) onSent();
    reset();
    onClose();
  };

  const handleDone = () => {
    reset();
    onSent();
    onClose();
  };

  const phoneDigits = useMemo(() => phone.replace(/\D+/g, ""), [phone]);
  const dailyRemaining = shareCtx?.dailyRemaining ?? null;
  const dailyLimit = shareCtx?.dailyLimit ?? null;
  const limitReached = isShareInviteLimitReached(dailyRemaining);
  const canSubmit = computeShareInviteCanSubmit({
    name,
    phoneDigits,
    submitting,
    dailyRemaining,
  });

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const recipientName = name.trim();
      const res = await createAppInvite({
        recipientName,
        recipientPhone: phoneDigits,
        invitedKind: kind,
      });
      void queryClient.invalidateQueries({
        queryKey: getGetAppInviteShareContextQueryKey(),
      });
      // Switch to the send-options panel. The user's next tap on
      // "Open Messages" carries a fresh user-gesture context, which iOS
      // Safari requires to actually launch the Messages app from a `sms:`
      // URL — auto-launching here from the post-await callback would be
      // silently blocked.
      setSent({
        smsUri: res.smsUri,
        smsBody: res.smsBody,
        recipientName,
      });
      setSubmitting(false);
    } catch (e) {
      setError(extractApiErrorMessage(e, "Could not create invite. Please try again."));
      void queryClient.invalidateQueries({
        queryKey: getGetAppInviteShareContextQueryKey(),
      });
      setSubmitting(false);
    }
  };

  const missing = shareCtx?.missingFields ?? [];
  const hint = missing.length > 0 ? buildMissingHint(missing) : null;
  const limitHint = buildShareInviteLimitHint(dailyLimit, dailyRemaining);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={close}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.backdrop}
      >
        <Pressable style={StyleSheet.absoluteFill} onPress={close} />
        <View style={[styles.sheet, { backgroundColor: colors.background }]}> 
          <View style={styles.headerRow}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.title, { color: colors.foreground }]}>
                Share Round House
              </Text>
              <Text style={[styles.sub, { color: colors.mutedForeground }]}>
                Earn 10 points when they sign up.
              </Text>
            </View>
            <RisingSunSticker size={56} points={10} />
            <Pressable
              hitSlop={12}
              onPress={close}
              style={styles.closeBtn}
              accessibilityLabel="Close"
            >
              <Feather name="x" size={20} color={colors.mutedForeground} />
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
            {sent ? (
              <InviteSendOptions
                smsUri={sent.smsUri}
                smsBody={sent.smsBody}
                recipientName={sent.recipientName}
                onDone={handleDone}
              />
            ) : (
              <>
            {hint ? (
              <View
                style={[
                  styles.hint,
                  { borderColor: "#E0B400", backgroundColor: "rgba(224,180,0,0.12)" },
                ]}
              >
                <Feather name="alert-circle" size={16} color="#E0B400" />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.hintText, { color: colors.foreground }]}>
                    {hint}
                  </Text>
                  {onEditProfile ? (
                    <Pressable onPress={onEditProfile} hitSlop={6}>
                      <Text style={[styles.hintLink, { color: colors.primary }]}>
                        Edit your profile →
                      </Text>
                    </Pressable>
                  ) : null}
                </View>
              </View>
            ) : null}

            {limitHint ? (
              <View
                style={[
                  styles.hint,
                  {
                    borderColor: limitReached ? colors.destructive : colors.border,
                    backgroundColor: limitReached
                      ? `${colors.destructive}11`
                      : colors.card,
                  },
                ]}
              >
                <Feather
                  name={limitReached ? "slash" : "clock"}
                  size={16}
                  color={limitReached ? colors.destructive : colors.mutedForeground}
                />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.hintText, { color: colors.foreground }]}>
                    {limitHint}
                  </Text>
                </View>
              </View>
            ) : null}

            <Field
              label="Their name"
              value={name}
              onChangeText={setName}
              placeholder="First name"
              colors={colors}
              autoCapitalize="words"
            />
            <Field
              label="Cell phone"
              value={phone}
              onChangeText={setPhone}
              placeholder="(555) 123-4567"
              colors={colors}
              keyboardType="phone-pad"
            />

            <Text style={[styles.label, { color: colors.foreground, marginTop: 6 }]}>
              Invite them as
            </Text>
            <View style={styles.modeList}>
              {PICKER_OPTIONS.map((opt) => {
                const selected = opt.kind === kind;
                return (
                  <Pressable
                    key={opt.kind}
                    onPress={() => setKind(opt.kind)}
                    style={[
                      styles.modeRow,
                      {
                        borderColor: selected ? colors.primary : colors.border,
                        backgroundColor: selected
                          ? `${colors.primary}11`
                          : colors.card,
                      },
                    ]}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                  >
                    <View style={{ flex: 1 }}>
                      <Text
                        style={[
                          styles.modeLabel,
                          { color: selected ? colors.primary : colors.foreground },
                        ]}
                      >
                        {opt.label}
                      </Text>
                      <Text
                        style={[styles.modeTag, { color: colors.mutedForeground }]}
                        numberOfLines={1}
                      >
                        {MODE_TAGLINES[opt.kind]}
                      </Text>
                    </View>
                    {selected ? (
                      <Feather name="check-circle" size={18} color={colors.primary} />
                    ) : (
                      <Feather name="circle" size={18} color={colors.border} />
                    )}
                  </Pressable>
                );
              })}
            </View>

            {error ? (
              <Text style={[styles.error, { color: colors.destructive }]}>{error}</Text>
            ) : null}

            <Pressable
              accessibilityRole="button"
              disabled={!canSubmit}
              onPress={handleSubmit}
              style={[
                styles.cta,
                {
                  backgroundColor: canSubmit ? colors.primary : colors.muted,
                  opacity: canSubmit ? 1 : 0.6,
                },
              ]}
            >
              {submitting ? (
                <ActivityIndicator color={colors.primaryForeground} />
              ) : (
                <Text
                  style={[
                    styles.ctaText,
                    {
                      color: canSubmit
                        ? colors.primaryForeground
                        : colors.mutedForeground,
                    },
                  ]}
                >
                  Open SMS to send invite
                </Text>
              )}
            </Pressable>
            <Text style={[styles.fineprint, { color: colors.mutedForeground }]}>
              We'll open your messaging app with a draft. You send it. We track
              when they sign up so you get the points.
            </Text>
              </>
            )}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function buildMissingHint(missing: string[]): string {
  const parts: string[] = [];
  if (missing.includes("firstName")) parts.push("your first name");
  if (missing.includes("companyName")) parts.push("your company name");
  if (missing.includes("propertyName")) parts.push("your property profile name");
  if (parts.length === 0) return "";
  const list =
    parts.length === 1
      ? parts[0]
      : parts.length === 2
        ? `${parts[0]} and ${parts[1]}`
        : `${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}`;
  return `We'll send the invite without ${list}. Add it on your profile so future invites read more naturally.`;
}

function Field({
  label,
  value,
  onChangeText,
  placeholder,
  colors,
  keyboardType,
  autoCapitalize,
}: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  colors: ReturnType<typeof useColors>;
  keyboardType?: "default" | "phone-pad";
  autoCapitalize?: "none" | "words";
}) {
  return (
    <View style={styles.fieldGroup}>
      <Text style={[styles.label, { color: colors.foreground }]}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.mutedForeground}
        keyboardType={keyboardType ?? "default"}
        autoCapitalize={autoCapitalize ?? "sentences"}
        style={[
          styles.input,
          {
            color: colors.foreground,
            borderColor: colors.border,
            backgroundColor: colors.card,
          },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "flex-end",
  },
  sheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 18,
    paddingTop: 14,
    paddingBottom: 24,
    maxHeight: "90%",
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingBottom: 8,
  },
  title: { fontSize: 20, fontFamily: "Inter_700Bold" },
  sub: { fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 2 },
  closeBtn: { padding: 4, marginLeft: 4 },
  body: { paddingTop: 4, gap: 12, paddingBottom: 18 },
  hint: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
  },
  hintText: { fontSize: 13, fontFamily: "Inter_500Medium", lineHeight: 18 },
  hintLink: { fontSize: 13, fontFamily: "Inter_600SemiBold", marginTop: 6 },
  fieldGroup: { gap: 6 },
  label: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    height: 46,
    fontSize: 15,
    fontFamily: "Inter_500Medium",
  },
  modeList: { gap: 8, marginTop: 4 },
  modeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  modeLabel: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  modeTag: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  error: { fontSize: 13, fontFamily: "Inter_500Medium", marginTop: 4 },
  cta: {
    height: 50,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 6,
  },
  ctaText: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  fineprint: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    lineHeight: 17,
    marginTop: 4,
    textAlign: "center",
  },
});
