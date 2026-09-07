import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { useSendBusinessInvite, ApiError } from "@workspace/api-client-react";

interface Props {
  visible: boolean;
  onClose: () => void;
  initialName?: string;
  onInviteSent?: (label: string) => void;
}

const INVITE_LINK = "https://roundhouse.app/invite/business";

function buildEmailBody(businessName: string) {
  const who = businessName ? businessName : "your business";
  return (
    `Hi,\n\nI use Roundhouse to keep my home and projects organized, and I'd love to work with ${who} on there.\n\n` +
    `Roundhouse makes it easy to share property details, request quotes, and keep work history in one place.\n\n` +
    `Sign up here: ${INVITE_LINK}\n\nThanks!`
  );
}

export function BusinessInviteModal({
  visible,
  onClose,
  initialName,
  onInviteSent,
}: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [businessName, setBusinessName] = useState(initialName ?? "");
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState<"email" | "link" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sendInvite = useSendBusinessInvite();

  useEffect(() => {
    if (visible) {
      setBusinessName(initialName ?? "");
      setEmail("");
      setError(null);
      setSending(null);
    }
  }, [visible, initialName]);

  const trimmedEmail = email.trim();
  const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail);

  async function handleSendEmail() {
    if (!validEmail || sending) return;
    setSending("email");
    setError(null);
    try {
      const trimmedName = businessName.trim();
      await sendInvite.mutateAsync({
        data: {
          email: trimmedEmail,
          businessName: trimmedName.length > 0 ? trimmedName : null,
        },
      });
      onInviteSent?.(trimmedName || trimmedEmail);
      onClose();
    } catch (e) {
      const fallback = "Could not send the invite email. Please try again.";
      let message = fallback;
      if (e instanceof ApiError) {
        const detail =
          e.data && typeof e.data === "object" && "error" in e.data
            ? String((e.data as { error?: unknown }).error ?? "")
            : "";
        message = detail.trim() || fallback;
      } else if (e instanceof Error) {
        message = e.message || fallback;
      }
      setError(message);
    } finally {
      setSending(null);
    }
  }

  async function handleShareLink() {
    if (sending) return;
    setSending("link");
    setError(null);
    try {
      const message = buildEmailBody(businessName.trim());
      const result = await Share.share({
        message,
        title: "Invite to Roundhouse",
      });
      if (result.action !== Share.dismissedAction) {
        onInviteSent?.(businessName.trim() || "the business");
        onClose();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not open share sheet.");
    } finally {
      setSending(null);
    }
  }

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle={Platform.OS === "ios" ? "pageSheet" : "overFullScreen"}
      onRequestClose={onClose}
      transparent={Platform.OS !== "ios"}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={[styles.root, { backgroundColor: colors.background }]}
      >
        <View
          style={[
            styles.header,
            {
              borderBottomColor: colors.border,
              paddingTop: Platform.OS === "web" ? 16 : insets.top + 8,
            },
          ]}
        >
          <Pressable onPress={onClose} hitSlop={12} style={styles.iconBtn}>
            <Feather name="x" size={20} color={colors.foreground} />
          </Pressable>
          <Text style={[styles.title, { color: colors.foreground }]}>
            Invite a business
          </Text>
          <View style={{ width: 36 }} />
        </View>

        <View style={styles.body}>
          <Text style={[styles.intro, { color: colors.mutedForeground }]}>
            Send a Roundhouse invite by email, or share a link any way you like.
          </Text>

          <Text style={[styles.label, { color: colors.mutedForeground }]}>
            BUSINESS NAME (OPTIONAL)
          </Text>
          <TextInput
            value={businessName}
            onChangeText={setBusinessName}
            placeholder="ACME Plumbing"
            placeholderTextColor={colors.mutedForeground}
            autoCapitalize="words"
            style={[
              styles.input,
              {
                color: colors.foreground,
                backgroundColor: colors.card,
                borderColor: colors.border,
              },
            ]}
          />

          <Text style={[styles.label, { color: colors.mutedForeground }]}>
            EMAIL
          </Text>
          <TextInput
            value={email}
            onChangeText={setEmail}
            placeholder="hello@business.com"
            placeholderTextColor={colors.mutedForeground}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            style={[
              styles.input,
              {
                color: colors.foreground,
                backgroundColor: colors.card,
                borderColor: colors.border,
              },
            ]}
          />

          {error ? (
            <Text style={[styles.error, { color: colors.destructive }]}>
              {error}
            </Text>
          ) : null}

          <Pressable
            onPress={handleSendEmail}
            disabled={!validEmail || sending !== null}
            style={[
              styles.primaryBtn,
              {
                backgroundColor: validEmail
                  ? colors.primary
                  : colors.muted,
                opacity: sending === "email" ? 0.7 : 1,
              },
            ]}
          >
            {sending === "email" ? (
              <ActivityIndicator color={colors.primaryForeground} />
            ) : (
              <>
                <Feather
                  name="mail"
                  size={16}
                  color={
                    validEmail
                      ? colors.primaryForeground
                      : colors.mutedForeground
                  }
                />
                <Text
                  style={[
                    styles.primaryBtnText,
                    {
                      color: validEmail
                        ? colors.primaryForeground
                        : colors.mutedForeground,
                    },
                  ]}
                >
                  Send email invite
                </Text>
              </>
            )}
          </Pressable>

          <View style={styles.dividerRow}>
            <View style={[styles.divider, { backgroundColor: colors.border }]} />
            <Text style={[styles.dividerText, { color: colors.mutedForeground }]}>
              or
            </Text>
            <View style={[styles.divider, { backgroundColor: colors.border }]} />
          </View>

          <Pressable
            onPress={handleShareLink}
            disabled={sending !== null}
            style={[
              styles.secondaryBtn,
              {
                borderColor: colors.border,
                backgroundColor: colors.card,
                opacity: sending === "link" ? 0.7 : 1,
              },
            ]}
          >
            {sending === "link" ? (
              <ActivityIndicator color={colors.foreground} />
            ) : (
              <>
                <Feather name="share-2" size={16} color={colors.foreground} />
                <Text
                  style={[styles.secondaryBtnText, { color: colors.foreground }]}
                >
                  Share invite link
                </Text>
              </>
            )}
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  iconBtn: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  title: { fontSize: 16, fontFamily: "Inter_700Bold" },
  body: { padding: 20, gap: 8 },
  intro: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    lineHeight: 19,
    marginBottom: 8,
  },
  label: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 0.7,
    marginTop: 12,
    marginBottom: 6,
  },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: Platform.OS === "ios" ? 12 : 10,
    fontSize: 15,
    fontFamily: "Inter_400Regular",
  },
  error: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
    marginTop: 12,
  },
  primaryBtn: {
    marginTop: 18,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
    borderRadius: 12,
  },
  primaryBtnText: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  dividerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginVertical: 14,
  },
  divider: { flex: 1, height: StyleSheet.hairlineWidth },
  dividerText: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
  secondaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1,
  },
  secondaryBtnText: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
});

