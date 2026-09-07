import React, { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { confirm } from "@/lib/confirm";
import * as WebBrowser from "expo-web-browser";
import { Feather } from "@expo/vector-icons";
import { useLocalSearchParams } from "expo-router";
import { useColors } from "@/hooks/useColors";
import {
  useGetMyBilling,
  useEnableOutwardAccountBilling,
  useCancelOutwardAccountBilling,
  useAddBillingPaymentMethod,
  type BillingRow,
  type OutwardAccount,
} from "@workspace/api-client-react";
import { isHighlightedRow, orderHighlightedFirst } from "@/lib/billingRows";

const KIND_LABEL: Record<OutwardAccount["kind"], string> = {
  trade_pro: "Trade Pro",
  home: "Home",
  facilities: "Facility Management",
  trade_pro_teammate: "Trade Teammate",
  facilities_teammate: "Facility Teammate",
  home_teammate: "Home Teammate",
  trade_pro_collab: "Collaborator",
  facilities_collab: "Collaborator",
  collab: "Collaborator",
};

function formatPrice(cents: number, currency: string) {
  const amt = (cents / 100).toFixed(cents % 100 === 0 ? 0 : 2);
  return currency === "USD" ? `$${amt}` : `${amt} ${currency}`;
}

function formatPeriodEnd(iso: string | null | undefined) {
  if (!iso) return null;
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return null;
  }
}

export default function BillingScreen() {
  const colors = useColors();
  const params = useLocalSearchParams<{ accountId?: string }>();
  const highlightId = params.accountId ? Number(params.accountId) : null;
  const { data, isLoading, refetch } = useGetMyBilling();
  const enableMut = useEnableOutwardAccountBilling();
  const cancelMut = useCancelOutwardAccountBilling();
  const addPmMut = useAddBillingPaymentMethod();
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState("");

  const bundleLabel = data?.bundle.label ?? "Expanded capabilities";
  const priceText = data
    ? `${formatPrice(data.bundle.priceCents, data.bundle.currency)}/mo`
    : "";

  const orderedRows: BillingRow[] = useMemo(() => {
    if (!data) return [];
    return orderHighlightedFirst<BillingRow>(data.rows, highlightId);
  }, [data, highlightId]);

  const onAddPaymentMethod = async () => {
    setError("");
    try {
      const result = await addPmMut.mutateAsync();
      // When Stripe is connected the server returns a hosted Checkout
      // URL — open it in the in-app browser so the user enters their
      // card on Stripe's page (Expo Go can't ship native Stripe
      // Elements). When Stripe isn't configured the server returns
      // checkoutUrl: null and we just fall through to a refetch (legacy
      // placeholder behavior).
      if (result?.checkoutUrl) {
        await WebBrowser.openBrowserAsync(result.checkoutUrl);
      }
      await refetch();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't add payment method.");
    }
  };

  const onEnable = async (id: number) => {
    setError("");
    setBusyId(id);
    try {
      await enableMut.mutateAsync({ id });
      await refetch();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't enable.");
    } finally {
      setBusyId(null);
    }
  };

  const onCancel = async (row: BillingRow) => {
    const ok = await confirm({
      title: "Cancel expanded capabilities?",
      message: `"${row.outwardAccount.displayName || row.outwardAccount.title}" will return to the free baseline. Your data and connections stay intact.`,
      confirmLabel: "Cancel paid",
      cancelLabel: "Keep paid",
      destructive: true,
    });
    if (!ok) return;
    setError("");
    setBusyId(row.outwardAccount.id);
    try {
      await cancelMut.mutateAsync({ id: row.outwardAccount.id });
      await refetch();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't cancel.");
    } finally {
      setBusyId(null);
    }
  };

  if (isLoading || !data) {
    return (
      <View
        style={[
          styles.center,
          { backgroundColor: colors.background, flex: 1 },
        ]}
      >
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={{ padding: 16, gap: 18, paddingBottom: 48 }}
    >
      <Text style={[styles.h1, { color: colors.foreground }]}>Billing</Text>
      <Text style={[styles.help, { color: colors.mutedForeground }]}>
        Each outward account is free. Paid capabilities — creating property
        records and expanding member participation — are billed per account
        from your private profile. Cancelling never deletes anything.
      </Text>

      <View
        style={[
          styles.section,
          { backgroundColor: colors.card, borderColor: colors.border },
        ]}
      >
        <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>
          PAYMENT METHOD
        </Text>
        {data.paymentMethod.onFile ? (
          <View style={styles.pmRow}>
            <Feather name="credit-card" size={18} color={colors.foreground} />
            <Text style={[styles.pmText, { color: colors.foreground }]}>
              {data.paymentMethod.summary ?? "Card on file"}
            </Text>
          </View>
        ) : (
          <Pressable
            onPress={onAddPaymentMethod}
            style={({ pressed }) => [
              styles.pmAdd,
              {
                borderColor: colors.primary,
                backgroundColor: colors.primary + "15",
                opacity: pressed ? 0.7 : 1,
              },
            ]}
          >
            <Feather name="plus" size={16} color={colors.primary} />
            <Text style={[styles.pmAddText, { color: colors.primary }]}>
              Add payment method
            </Text>
          </Pressable>
        )}
      </View>

      <Text style={[styles.h2, { color: colors.foreground }]}>
        {bundleLabel} · {priceText}
      </Text>

      <View style={{ gap: 10 }}>
        {orderedRows.map((row) => {
          const acct = row.outwardAccount;
          const sub = row.subscription;
          const isExpanded = row.capabilityState === "expanded";
          const highlight = isHighlightedRow(row, highlightId);
          const periodEnd = formatPeriodEnd(sub?.currentPeriodEnd);
          const statusText = !sub
            ? "Free baseline"
            : sub.status === "active"
              ? periodEnd
                ? `Active · renews ${periodEnd}`
                : "Active"
              : sub.status === "past_due"
                ? "Payment failed — retrying"
                : sub.status === "cancelled"
                  ? "Cancelled"
                  : "Expired";
          return (
            <View
              key={acct.id}
              style={[
                styles.card,
                {
                  backgroundColor: colors.card,
                  borderColor: highlight ? colors.primary : colors.border,
                  borderWidth: highlight ? 2 : 1,
                },
              ]}
            >
              <View style={{ flex: 1 }}>
                <Text
                  style={[styles.rowTitle, { color: colors.foreground }]}
                  numberOfLines={1}
                >
                  {acct.displayName || acct.title}
                </Text>
                <Text
                  style={[styles.rowSub, { color: colors.mutedForeground }]}
                  numberOfLines={1}
                >
                  {KIND_LABEL[acct.kind]} · {statusText}
                </Text>
                {isExpanded ? (
                  <View
                    style={[
                      styles.badge,
                      { backgroundColor: colors.primary + "20" },
                    ]}
                  >
                    <Text style={[styles.badgeText, { color: colors.primary }]}>
                      EXPANDED
                    </Text>
                  </View>
                ) : (
                  <View
                    style={[styles.badge, { backgroundColor: colors.muted }]}
                  >
                    <Text
                      style={[
                        styles.badgeText,
                        { color: colors.mutedForeground },
                      ]}
                    >
                      STANDARD
                    </Text>
                  </View>
                )}
              </View>
              {isExpanded ? (
                <Pressable
                  onPress={() => onCancel(row)}
                  disabled={busyId === acct.id}
                  style={({ pressed }) => [
                    styles.actionBtn,
                    {
                      borderColor: colors.border,
                      opacity: pressed ? 0.7 : 1,
                    },
                  ]}
                >
                  {busyId === acct.id ? (
                    <ActivityIndicator
                      size="small"
                      color={colors.mutedForeground}
                    />
                  ) : (
                    <Text
                      style={[
                        styles.actionTxt,
                        { color: colors.mutedForeground },
                      ]}
                    >
                      Cancel
                    </Text>
                  )}
                </Pressable>
              ) : (
                <Pressable
                  onPress={() => onEnable(acct.id)}
                  disabled={busyId === acct.id}
                  style={({ pressed }) => [
                    styles.actionBtn,
                    {
                      borderColor: colors.primary,
                      backgroundColor: colors.primary,
                      opacity: pressed ? 0.85 : 1,
                    },
                  ]}
                >
                  {busyId === acct.id ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <Text style={[styles.actionTxt, { color: "#fff" }]}>
                      Enable
                    </Text>
                  )}
                </Pressable>
              )}
            </View>
          );
        })}
      </View>

      {error ? (
        <Text style={{ color: colors.destructive, fontSize: 13 }}>{error}</Text>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: "center", justifyContent: "center" },
  h1: { fontSize: 22, fontFamily: "Inter_700Bold" },
  h2: { fontSize: 16, fontFamily: "Inter_600SemiBold", marginTop: 8 },
  help: { fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 19 },
  section: {
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    gap: 10,
  },
  sectionLabel: {
    fontSize: 11,
    fontFamily: "Inter_700Bold",
    letterSpacing: 0.8,
  },
  pmRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  pmText: { fontSize: 14, fontFamily: "Inter_500Medium" },
  pmAdd: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
  },
  pmAddText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 14,
    borderRadius: 14,
  },
  rowTitle: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  rowSub: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  badge: {
    alignSelf: "flex-start",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
    marginTop: 6,
  },
  badgeText: { fontSize: 10, fontFamily: "Inter_700Bold", letterSpacing: 0.8 },
  actionBtn: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 999,
    borderWidth: 1,
    minWidth: 80,
    alignItems: "center",
    justifyContent: "center",
  },
  actionTxt: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
});
