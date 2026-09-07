import React, { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  ApiError,
  useUpdateOutwardAccount,
  useDeleteOutwardAccount,
  useGetOutwardAccountDeleteImpact,
  useGetOutwardAccountReassignImpact,
  useReassignAndDeleteOutwardAccount,
  useTransferOutwardAccountAvatar,
  type OutwardAccountReassignImpact,
  type ReassignImpactConnection,
} from "@workspace/api-client-react";

// Business kinds — must mirror BUSINESS_KINDS on the server. Used for the
// "last business account" delete recommendation and the avatar handoff
// flow (avatar transfer is only meaningful between business outward
// profiles, since homeowner / collab default to the personal avatar).
const BUSINESS_KINDS = ["trade_pro", "facilities"] as const;
type BusinessKind = (typeof BUSINESS_KINDS)[number];
const isBusinessKind = (k: string): k is BusinessKind =>
  (BUSINESS_KINDS as readonly string[]).includes(k);
import { useColors } from "@/hooks/useColors";
import { useProfile } from "@/lib/profile";
import {
  OutwardAccountForm,
  type OutwardAccountFormValues,
} from "@/components/OutwardAccountForm";
import { confirm } from "@/lib/confirm";

export default function EditOutwardAccountScreen() {
  const colors = useColors();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { id } = useLocalSearchParams<{ id: string }>();
  const accountId = Number(id);
  const {
    outwardAccounts,
    activeOutwardAccount,
    refetchOutwardAccounts,
    refetchProfile,
  } = useProfile();
  const updateMutation = useUpdateOutwardAccount();
  const deleteMutation = useDeleteOutwardAccount();
  const reassignMutation = useReassignAndDeleteOutwardAccount();
  const transferAvatarMutation = useTransferOutwardAccountAvatar();
  const impactQuery = useGetOutwardAccountDeleteImpact(accountId);
  const [deleteError, setDeleteError] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [handoffOpen, setHandoffOpen] = useState(false);
  const [handoffTargetId, setHandoffTargetId] = useState<number | null>(null);
  // "Last business account" recommendation sheet — surfaced when the user
  // is about to delete the only remaining business outward profile and
  // we want to suggest creating a Homeowner / Collaborator first so they
  // don't end up with zero non-business accounts. The sheet has shortcuts
  // to the create flow pre-filled with the recommended kind.
  const [recommendOpen, setRecommendOpen] = useState(false);
  // Avatar transfer modal state — only relevant for business kinds.
  const [avatarTransferOpen, setAvatarTransferOpen] = useState(false);
  const [avatarTargetId, setAvatarTargetId] = useState<number | null>(null);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [avatarError, setAvatarError] = useState("");

  const account = outwardAccounts.find((a) => a.id === accountId) ?? null;

  // Other live accounts the user could hand the connections off to.
  const handoffCandidates = useMemo(
    () => outwardAccounts.filter((a) => a.id !== accountId),
    [outwardAccounts, accountId],
  );

  const reassignImpactQuery = useGetOutwardAccountReassignImpact(
    accountId,
    { targetId: handoffTargetId ?? 0 },
    {
      query: {
        queryKey: [
          "getOutwardAccountReassignImpact",
          accountId,
          handoffTargetId,
        ],
        enabled:
          handoffOpen && handoffTargetId !== null && handoffTargetId !== accountId,
      },
    },
  );

  if (!account) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: colors.background,
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
        }}
      >
        {outwardAccounts.length === 0 ? (
          <ActivityIndicator color={colors.mutedForeground} />
        ) : (
          <Text style={{ color: colors.mutedForeground, textAlign: "center" }}>
            That account is no longer available.
          </Text>
        )}
      </View>
    );
  }

  const initial: OutwardAccountFormValues = {
    kind: account.kind as OutwardAccountFormValues["kind"],
    title: account.title ?? "",
    displayName: account.displayName ?? "",
    bannerUrl: account.bannerUrl ?? null,
    companyName: account.companyName ?? "",
    bio: account.bio ?? "",
    // #640 — Hydrate the per-skin "show last initial only" privacy
    // toggle from the server. Older payloads (pre-#640) won't carry
    // this field; default to OFF so we don't silently shorten a name.
    lastInitialOnly: !!account.lastInitialOnly,
  };

  const onSubmit = async (values: OutwardAccountFormValues) => {
    await updateMutation.mutateAsync({
      id: accountId,
      data: {
        title: values.title,
        displayName: values.displayName,
        // Avatar is shared across every outward account — it always comes
        // from the personal profile, never per-skin. Don't overwrite the
        // (legacy) per-account value here either; it's ignored on render.
        bannerUrl: values.bannerUrl,
        companyName: values.companyName.trim() ? values.companyName.trim() : null,
        bio: values.bio.trim() ? values.bio.trim() : null,
        lastInitialOnly: values.lastInitialOnly,
      },
    });
    await Promise.all([refetchOutwardAccounts(), refetchProfile()]);
    if (router.canGoBack()) router.back();
  };

  const isActive = activeOutwardAccount?.id === accountId;
  const isOnly = outwardAccounts.length <= 1;
  const connectionCount = impactQuery.data?.connectionCount ?? 0;
  const label = account.displayName || account.title || "this account";
  const hasConnections = connectionCount > 0;
  const canHandOff = hasConnections && handoffCandidates.length > 0;
  const accountIsBusiness = isBusinessKind(account.kind);
  // Other live business accounts the avatar could be moved to. Empty when
  // there's no peer business profile, in which case the transfer action
  // is hidden and the user can still remove the avatar outright.
  const businessHandoffCandidates = useMemo(
    () => handoffCandidates.filter((a) => isBusinessKind(a.kind)),
    [handoffCandidates],
  );
  // Number of *other* live business accounts. Used to detect whether
  // deleting this one would leave the user with zero business profiles
  // — in which case we surface the recommendation sheet.
  const otherBusinessCount = businessHandoffCandidates.length;
  const isLastBusiness = accountIsBusiness && otherBusinessCount === 0;

  // Block delete with a clear reason if it would strand the user. The
  // server enforces these too, but failing fast in the UI is friendlier.
  const blockedReason = isOnly
    ? "You need to keep at least one account. Create another one first."
    : isActive
      ? "Switch to another account before deleting this one."
      : null;

  const finishDelete = async () => {
    await Promise.all([refetchOutwardAccounts(), refetchProfile()]);
    await queryClient.invalidateQueries();
    if (router.canGoBack()) router.back();
    else router.replace("/account" as never);
  };

  const confirmAndDelete = async () => {
    const lines: string[] = [];
    if (connectionCount > 0) {
      lines.push(
        `${connectionCount} connection${connectionCount === 1 ? "" : "s"} (contacts, clients, collaborators) tied to this account will be removed from your relationships.`,
      );
    }
    lines.push(
      "The account itself will be hidden from your switcher. History stays in our records — nothing is permanently erased.",
    );
    // #627: Route the destructive confirm through `lib/confirm.ts` so
    // the dialog actually surfaces on react-native-web (where bare RN
    // `Alert.alert` is a no-op stub). Native still gets a real RN
    // alert because the helper falls back to `Alert.alert` off-web.
    const ok = await confirm({
      title: `Delete "${label}"?`,
      message: lines.join("\n\n"),
      confirmLabel: "Delete",
      cancelLabel: "Cancel",
      destructive: true,
    });
    if (!ok) return;
    setDeleteError("");
    setDeleting(true);
    try {
      await deleteMutation.mutateAsync({ id: accountId });
      await finishDelete();
    } catch (e) {
      setDeleteError(
        e instanceof Error ? e.message : "Couldn't delete account.",
      );
    } finally {
      setDeleting(false);
    }
  };

  const onDeleteWithHistoryPress = () => {
    if (blockedReason) {
      setDeleteError(blockedReason);
      return;
    }
    setDeleteError("");
    // Friendly nudge before destroying the user's last business profile:
    // open the recommendation sheet so they can stash a Homeowner /
    // Collaborator account first. They can still proceed straight to
    // delete from inside the sheet.
    if (isLastBusiness) {
      setRecommendOpen(true);
      return;
    }
    confirmAndDelete();
  };

  // Per-account avatar actions (business kinds only). Removing clears the
  // avatar back to whatever the personal-profile avatar is. Transferring
  // hands the current avatar to another business account in one round
  // trip — the source account is left avatar-less.
  const onRemoveAvatarPress = async () => {
    if (!account.avatarUrl) return;
    // #627: Route the destructive confirm through `lib/confirm.ts` so
    // the dialog actually surfaces on react-native-web (where bare RN
    // `Alert.alert` is a no-op stub). Native still gets a real RN
    // alert because the helper falls back to `Alert.alert` off-web.
    const ok = await confirm({
      title: "Remove avatar?",
      message: "This account will fall back to your personal profile avatar.",
      confirmLabel: "Remove",
      cancelLabel: "Cancel",
      destructive: true,
    });
    if (!ok) return;
    setAvatarError("");
    setAvatarBusy(true);
    try {
      await updateMutation.mutateAsync({
        id: accountId,
        data: { avatarUrl: null },
      });
      await refetchOutwardAccounts();
    } catch (e) {
      setAvatarError(
        e instanceof Error ? e.message : "Couldn't remove the avatar.",
      );
    } finally {
      setAvatarBusy(false);
    }
  };

  const onTransferAvatarPress = () => {
    if (!account.avatarUrl) return;
    if (businessHandoffCandidates.length === 0) {
      setAvatarError(
        "No other business account to transfer the avatar to.",
      );
      return;
    }
    setAvatarError("");
    setAvatarTargetId(businessHandoffCandidates[0]?.id ?? null);
    setAvatarTransferOpen(true);
  };

  const onConfirmAvatarTransfer = async () => {
    if (avatarTargetId === null) return;
    setAvatarBusy(true);
    setAvatarError("");
    try {
      await transferAvatarMutation.mutateAsync({
        id: accountId,
        data: { targetId: avatarTargetId },
      });
      await refetchOutwardAccounts();
      setAvatarTransferOpen(false);
    } catch (e) {
      if (
        e instanceof ApiError &&
        e.status === 409 &&
        e.data &&
        typeof e.data === "object" &&
        (e.data as { code?: unknown }).code === "non_business_kind"
      ) {
        setAvatarError(
          "Avatar transfer is only available between Trade Pro and Facilities accounts.",
        );
      } else {
        setAvatarError(
          e instanceof Error ? e.message : "Couldn't transfer the avatar.",
        );
      }
    } finally {
      setAvatarBusy(false);
    }
  };

  const onHandOffPress = () => {
    if (blockedReason) {
      setDeleteError(blockedReason);
      return;
    }
    setDeleteError("");
    // Default to whichever other account is currently active, otherwise
    // the first candidate. Saves a tap in the common case.
    const fallback =
      handoffCandidates.find((a) => a.id === activeOutwardAccount?.id)?.id ??
      handoffCandidates[0]?.id ??
      null;
    setHandoffTargetId(fallback);
    setHandoffOpen(true);
  };

  const onConfirmHandOff = async () => {
    if (handoffTargetId === null) return;
    setDeleteError("");
    setDeleting(true);
    try {
      await reassignMutation.mutateAsync({
        id: accountId,
        data: { targetId: handoffTargetId },
      });
      setHandoffOpen(false);
      await finishDelete();
    } catch (e) {
      setDeleteError(
        e instanceof Error ? e.message : "Couldn't hand off and delete.",
      );
    } finally {
      setDeleting(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <OutwardAccountForm
        initial={initial}
        lockKind
        submitLabel="Save changes"
        onSubmit={onSubmit}
        onCancel={() => router.back()}
        footer={
          <>
            {accountIsBusiness ? (
              <View
                style={[
                  styles.danger,
                  { borderColor: colors.border, marginTop: 18 },
                ]}
              >
                <View style={styles.dangerHeader}>
                  <Feather
                    name="image"
                    size={16}
                    color={colors.foreground}
                  />
                  <Text
                    style={[styles.dangerTitle, { color: colors.foreground }]}
                  >
                    Account avatar
                  </Text>
                </View>
                <Text
                  style={[
                    styles.dangerBody,
                    { color: colors.mutedForeground },
                  ]}
                >
                  {account.avatarUrl
                    ? "Remove this avatar to fall back to your personal one, or move it to another business account."
                    : "This account is using your personal-profile avatar."}
                </Text>
                {account.avatarUrl ? (
                  <View style={{ gap: 8 }}>
                    <Pressable
                      onPress={onRemoveAvatarPress}
                      disabled={avatarBusy}
                      style={({ pressed }) => [
                        styles.handoffBtn,
                        {
                          borderColor: colors.border,
                          backgroundColor: colors.background,
                          opacity: pressed || avatarBusy ? 0.6 : 1,
                        },
                      ]}
                    >
                      <Feather
                        name="x-circle"
                        size={14}
                        color={colors.foreground}
                      />
                      <Text
                        style={[
                          styles.dangerBtnTxt,
                          { color: colors.foreground },
                        ]}
                      >
                        Remove account avatar
                      </Text>
                    </Pressable>
                    {businessHandoffCandidates.length > 0 ? (
                      <Pressable
                        onPress={onTransferAvatarPress}
                        disabled={avatarBusy}
                        style={({ pressed }) => [
                          styles.handoffBtn,
                          {
                            borderColor: colors.border,
                            backgroundColor: colors.background,
                            opacity: pressed || avatarBusy ? 0.6 : 1,
                          },
                        ]}
                      >
                        <Feather
                          name="corner-up-right"
                          size={14}
                          color={colors.foreground}
                        />
                        <Text
                          style={[
                            styles.dangerBtnTxt,
                            { color: colors.foreground },
                          ]}
                        >
                          Transfer avatar to another business account
                        </Text>
                      </Pressable>
                    ) : null}
                  </View>
                ) : null}
                {avatarError ? (
                  <Text style={{ color: colors.destructive, fontSize: 13 }}>
                    {avatarError}
                  </Text>
                ) : null}
              </View>
            ) : null}

            {/*
              #572: the Collaborator / Friend baseline is permanent —
              every user always has exactly one. Hide the Danger zone
              entirely so users aren't tempted to try (the server also
              rejects with `protected_baseline`, but UI clarity beats
              an error round-trip).
            */}
            {account.kind === "collab" ? null : (
            <View
              style={[
                styles.danger,
                { borderColor: colors.destructive + "55" },
              ]}
            >
              <View style={styles.dangerHeader}>
                <Feather
                  name="alert-triangle"
                  size={16}
                  color={colors.destructive}
                />
                <Text
                  style={[styles.dangerTitle, { color: colors.destructive }]}
                >
                  Danger zone
                </Text>
              </View>
            <Text
              style={[styles.dangerBody, { color: colors.mutedForeground }]}
            >
              {hasConnections
                ? `This account has ${connectionCount} connection${connectionCount === 1 ? "" : "s"} (contacts, clients, collaborators).`
                : "Deleting will hide this account from your switcher. History is kept in our records."}
            </Text>
            {hasConnections ? (
              <Text
                style={[styles.dangerBody, { color: colors.mutedForeground }]}
              >
                You can move them onto another account first, or delete with the
                history kept on file.
              </Text>
            ) : null}
            {blockedReason ? (
              <Text
                style={[styles.dangerBody, { color: colors.mutedForeground }]}
              >
                {blockedReason}
              </Text>
            ) : null}
            {canHandOff ? (
              <Pressable
                onPress={onHandOffPress}
                disabled={deleting || !!blockedReason}
                style={({ pressed }) => [
                  styles.handoffBtn,
                  {
                    borderColor: colors.destructive,
                    backgroundColor: colors.background,
                    opacity: pressed || deleting || blockedReason ? 0.6 : 1,
                  },
                ]}
              >
                <Feather
                  name="corner-up-right"
                  size={14}
                  color={colors.destructive}
                />
                <Text
                  style={[styles.dangerBtnTxt, { color: colors.destructive }]}
                >
                  Move connections to another account
                </Text>
              </Pressable>
            ) : null}
            <Pressable
              onPress={onDeleteWithHistoryPress}
              disabled={deleting || !!blockedReason}
              style={({ pressed }) => [
                styles.dangerBtn,
                {
                  borderColor: colors.destructive,
                  backgroundColor: colors.destructive + "12",
                  opacity: pressed || deleting || blockedReason ? 0.6 : 1,
                },
              ]}
            >
              {deleting ? (
                <ActivityIndicator size="small" color={colors.destructive} />
              ) : (
                <Feather name="trash-2" size={14} color={colors.destructive} />
              )}
              <Text
                style={[styles.dangerBtnTxt, { color: colors.destructive }]}
              >
                {hasConnections
                  ? "Delete with history retained"
                  : "Delete this account"}
              </Text>
            </Pressable>
            {deleteError ? (
              <Text style={{ color: colors.destructive, fontSize: 13 }}>
                {deleteError}
              </Text>
            ) : null}
            </View>
            )}
          </>
        }
      />

      <Modal
        visible={handoffOpen}
        animationType="slide"
        transparent
        onRequestClose={() => (deleting ? undefined : setHandoffOpen(false))}
      >
        <View style={styles.modalScrim}>
          <View
            style={[
              styles.modalSheet,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: colors.foreground }]}>
                Move connections
              </Text>
              <Pressable
                onPress={() => (deleting ? undefined : setHandoffOpen(false))}
                hitSlop={10}
                disabled={deleting}
              >
                <Feather
                  name="x"
                  size={20}
                  color={colors.mutedForeground}
                />
              </Pressable>
            </View>
            <Text
              style={[styles.modalBody, { color: colors.mutedForeground }]}
            >
              Pick which of your other accounts should receive the {connectionCount}{" "}
              connection{connectionCount === 1 ? "" : "s"} from "{label}". After the
              hand-off, this account will be hidden from your switcher.
            </Text>
            <ScrollView
              style={styles.targetList}
              contentContainerStyle={{ gap: 8 }}
            >
              {handoffCandidates.map((cand) => {
                const selected = handoffTargetId === cand.id;
                return (
                  <Pressable
                    key={cand.id}
                    onPress={() =>
                      deleting ? undefined : setHandoffTargetId(cand.id)
                    }
                    style={({ pressed }) => [
                      styles.targetRow,
                      {
                        borderColor: selected
                          ? colors.primary
                          : colors.border,
                        backgroundColor: selected
                          ? colors.primary + "10"
                          : "transparent",
                        opacity: pressed ? 0.7 : 1,
                      },
                    ]}
                  >
                    <View style={{ flex: 1 }}>
                      <Text
                        style={[
                          styles.targetTitle,
                          { color: colors.foreground },
                        ]}
                        numberOfLines={1}
                      >
                        {cand.displayName || cand.title || "Untitled account"}
                      </Text>
                      <Text
                        style={[
                          styles.targetSub,
                          { color: colors.mutedForeground },
                        ]}
                        numberOfLines={1}
                      >
                        {cand.title || cand.kind}
                      </Text>
                    </View>
                    <Feather
                      name={selected ? "check-circle" : "circle"}
                      size={18}
                      color={
                        selected ? colors.primary : colors.mutedForeground
                      }
                    />
                  </Pressable>
                );
              })}
            </ScrollView>
            <View
              style={[
                styles.previewBox,
                { backgroundColor: colors.muted, borderColor: colors.border },
              ]}
            >
              {handoffTargetId === null ? (
                <Text
                  style={[
                    styles.previewLine,
                    { color: colors.mutedForeground },
                  ]}
                >
                  Pick an account to see what would move.
                </Text>
              ) : reassignImpactQuery.isLoading ? (
                <ActivityIndicator color={colors.mutedForeground} />
              ) : reassignImpactQuery.data ? (
                <ImpactBreakdown
                  data={reassignImpactQuery.data}
                  colors={colors}
                />
              ) : (
                <Text
                  style={[
                    styles.previewLine,
                    { color: colors.mutedForeground },
                  ]}
                >
                  Couldn't preview the hand-off.
                </Text>
              )}
            </View>
            <View style={styles.modalActions}>
              <Pressable
                onPress={() => setHandoffOpen(false)}
                disabled={deleting}
                style={({ pressed }) => [
                  styles.modalCancel,
                  {
                    borderColor: colors.border,
                    opacity: pressed || deleting ? 0.6 : 1,
                  },
                ]}
              >
                <Text style={{ color: colors.foreground, fontSize: 14 }}>
                  Cancel
                </Text>
              </Pressable>
              <Pressable
                onPress={onConfirmHandOff}
                disabled={
                  deleting ||
                  handoffTargetId === null ||
                  reassignImpactQuery.isLoading
                }
                style={({ pressed }) => [
                  styles.modalConfirm,
                  {
                    backgroundColor: colors.destructive,
                    opacity:
                      pressed ||
                      deleting ||
                      handoffTargetId === null ||
                      reassignImpactQuery.isLoading
                        ? 0.6
                        : 1,
                  },
                ]}
              >
                {deleting ? (
                  <ActivityIndicator
                    size="small"
                    color={colors.destructiveForeground}
                  />
                ) : (
                  <Text
                    style={{
                      color: colors.destructiveForeground,
                      fontSize: 14,
                      fontFamily: "Inter_600SemiBold",
                    }}
                  >
                    Move &amp; delete
                  </Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* "Last business account" recommendation sheet. Surfaces shortcuts
          to create a Homeowner / Collaborator outward account before the
          user nukes their final business profile. They can also choose
          to delete anyway. */}
      <Modal
        visible={recommendOpen}
        animationType="slide"
        transparent
        onRequestClose={() => setRecommendOpen(false)}
      >
        <View style={styles.modalScrim}>
          <View
            style={[
              styles.modalSheet,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: colors.foreground }]}>
                Keep a non-business account?
              </Text>
              <Pressable
                onPress={() => setRecommendOpen(false)}
                hitSlop={10}
              >
                <Feather
                  name="x"
                  size={20}
                  color={colors.mutedForeground}
                />
              </Pressable>
            </View>
            <Text
              style={[styles.modalBody, { color: colors.mutedForeground }]}
            >
              "{label}" is your last business account. Most people keep at
              least one Home or Collaborator account so they can still
              receive jobs and stay connected. You can create one now and
              come back to delete this one later.
            </Text>
            <Pressable
              onPress={() => {
                setRecommendOpen(false);
                router.push("/account/create?kind=home" as never);
              }}
              style={({ pressed }) => [
                styles.handoffBtn,
                {
                  borderColor: colors.primary,
                  backgroundColor: colors.primary + "12",
                  opacity: pressed ? 0.6 : 1,
                },
              ]}
            >
              <Feather name="home" size={14} color={colors.primary} />
              <Text style={[styles.dangerBtnTxt, { color: colors.primary }]}>
                Create a Home account
              </Text>
            </Pressable>
            <Pressable
              onPress={() => {
                setRecommendOpen(false);
                router.push("/account/create?kind=collab" as never);
              }}
              style={({ pressed }) => [
                styles.handoffBtn,
                {
                  borderColor: colors.primary,
                  backgroundColor: colors.primary + "12",
                  opacity: pressed ? 0.6 : 1,
                },
              ]}
            >
              <Feather name="users" size={14} color={colors.primary} />
              <Text style={[styles.dangerBtnTxt, { color: colors.primary }]}>
                Create a Collaborator account
              </Text>
            </Pressable>
            <Pressable
              onPress={() => {
                setRecommendOpen(false);
                confirmAndDelete();
              }}
              style={({ pressed }) => [
                styles.dangerBtn,
                {
                  borderColor: colors.destructive,
                  backgroundColor: colors.destructive + "12",
                  opacity: pressed ? 0.6 : 1,
                },
              ]}
            >
              <Feather name="trash-2" size={14} color={colors.destructive} />
              <Text
                style={[styles.dangerBtnTxt, { color: colors.destructive }]}
              >
                Delete this account anyway
              </Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* Avatar transfer modal — pick which other business account
          should receive this account's avatar. Source is left without
          one (falls back to the personal avatar in the UI). */}
      <Modal
        visible={avatarTransferOpen}
        animationType="slide"
        transparent
        onRequestClose={() =>
          avatarBusy ? undefined : setAvatarTransferOpen(false)
        }
      >
        <View style={styles.modalScrim}>
          <View
            style={[
              styles.modalSheet,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: colors.foreground }]}>
                Transfer avatar
              </Text>
              <Pressable
                onPress={() =>
                  avatarBusy ? undefined : setAvatarTransferOpen(false)
                }
                disabled={avatarBusy}
                hitSlop={10}
              >
                <Feather
                  name="x"
                  size={20}
                  color={colors.mutedForeground}
                />
              </Pressable>
            </View>
            <Text
              style={[styles.modalBody, { color: colors.mutedForeground }]}
            >
              Pick which other business account should take this avatar.
              "{label}" will be left without one and fall back to your
              personal avatar.
            </Text>
            <ScrollView
              style={styles.targetList}
              contentContainerStyle={{ gap: 8 }}
            >
              {businessHandoffCandidates.map((cand) => {
                const selected = avatarTargetId === cand.id;
                return (
                  <Pressable
                    key={cand.id}
                    onPress={() =>
                      avatarBusy ? undefined : setAvatarTargetId(cand.id)
                    }
                    style={({ pressed }) => [
                      styles.targetRow,
                      {
                        borderColor: selected
                          ? colors.primary
                          : colors.border,
                        backgroundColor: selected
                          ? colors.primary + "10"
                          : "transparent",
                        opacity: pressed ? 0.7 : 1,
                      },
                    ]}
                  >
                    <View style={{ flex: 1 }}>
                      <Text
                        style={[
                          styles.targetTitle,
                          { color: colors.foreground },
                        ]}
                        numberOfLines={1}
                      >
                        {cand.displayName ||
                          cand.title ||
                          "Untitled account"}
                      </Text>
                      <Text
                        style={[
                          styles.targetSub,
                          { color: colors.mutedForeground },
                        ]}
                        numberOfLines={1}
                      >
                        {cand.title || cand.kind}
                      </Text>
                    </View>
                    <Feather
                      name={selected ? "check-circle" : "circle"}
                      size={18}
                      color={
                        selected ? colors.primary : colors.mutedForeground
                      }
                    />
                  </Pressable>
                );
              })}
            </ScrollView>
            {avatarError ? (
              <Text style={{ color: colors.destructive, fontSize: 13 }}>
                {avatarError}
              </Text>
            ) : null}
            <View style={styles.modalActions}>
              <Pressable
                onPress={() => setAvatarTransferOpen(false)}
                disabled={avatarBusy}
                style={({ pressed }) => [
                  styles.modalCancel,
                  {
                    borderColor: colors.border,
                    opacity: pressed || avatarBusy ? 0.6 : 1,
                  },
                ]}
              >
                <Text style={{ color: colors.foreground, fontSize: 14 }}>
                  Cancel
                </Text>
              </Pressable>
              <Pressable
                onPress={onConfirmAvatarTransfer}
                disabled={avatarBusy || avatarTargetId === null}
                style={({ pressed }) => [
                  styles.modalConfirm,
                  {
                    backgroundColor: colors.primary,
                    opacity:
                      pressed || avatarBusy || avatarTargetId === null
                        ? 0.6
                        : 1,
                  },
                ]}
              >
                {avatarBusy ? (
                  <ActivityIndicator
                    size="small"
                    color={colors.primaryForeground}
                  />
                ) : (
                  <Text
                    style={{
                      color: colors.primaryForeground,
                      fontSize: 14,
                      fontFamily: "Inter_600SemiBold",
                    }}
                  >
                    Transfer
                  </Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

// Renders the two short lists ("Will move" / "Already on target — will be
// archived") under the hand-off picker, with a small avatar + name per
// connection so users can spot exactly who is affected before confirming.
function ImpactBreakdown({
  data,
  colors,
}: {
  data: OutwardAccountReassignImpact;
  colors: ReturnType<typeof useColors>;
}) {
  const { toMove, toArchive, totalCount } = data;
  return (
    <View style={{ gap: 10 }}>
      <Text style={[styles.previewLine, { color: colors.foreground }]}>
        {toMove.length} of {totalCount} connection
        {totalCount === 1 ? "" : "s"} will move to the selected account.
      </Text>
      {toMove.length > 0 ? (
        <ImpactList
          label="Will move"
          rows={toMove}
          colors={colors}
          tone="positive"
        />
      ) : null}
      {toArchive.length > 0 ? (
        <ImpactList
          label="Already on the target — will be archived"
          rows={toArchive}
          colors={colors}
          tone="muted"
        />
      ) : null}
    </View>
  );
}

function ImpactList({
  label,
  rows,
  colors,
  tone,
}: {
  label: string;
  rows: ReassignImpactConnection[];
  colors: ReturnType<typeof useColors>;
  tone: "positive" | "muted";
}) {
  const accent = tone === "positive" ? colors.primary : colors.mutedForeground;
  return (
    <View style={{ gap: 6 }}>
      <Text
        style={[styles.impactListLabel, { color: accent }]}
        numberOfLines={1}
      >
        {label} ({rows.length})
      </Text>
      <View style={{ gap: 4 }}>
        {rows.map((row) => (
          <ImpactRow key={row.connectionId} row={row} colors={colors} />
        ))}
      </View>
    </View>
  );
}

function ImpactRow({
  row,
  colors,
}: {
  row: ReassignImpactConnection;
  colors: ReturnType<typeof useColors>;
}) {
  const name =
    row.otherAccount.displayName ||
    row.otherAccount.title ||
    "Unnamed connection";
  const initial = name.trim().charAt(0).toUpperCase() || "?";
  return (
    <View style={styles.impactRow}>
      {row.otherAccount.avatarUrl ? (
        <Image
          source={{ uri: row.otherAccount.avatarUrl }}
          style={[styles.impactAvatar, { backgroundColor: colors.muted }]}
        />
      ) : (
        <View
          style={[
            styles.impactAvatar,
            styles.impactAvatarFallback,
            { backgroundColor: colors.muted, borderColor: colors.border },
          ]}
        >
          <Text
            style={{
              color: colors.mutedForeground,
              fontSize: 10,
              fontFamily: "Inter_600SemiBold",
            }}
          >
            {initial}
          </Text>
        </View>
      )}
      <Text
        style={[styles.impactRowName, { color: colors.foreground }]}
        numberOfLines={1}
      >
        {name}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  danger: {
    marginTop: 24,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    gap: 10,
  },
  dangerHeader: { flexDirection: "row", alignItems: "center", gap: 8 },
  dangerTitle: { fontSize: 14, fontFamily: "Inter_700Bold" },
  dangerBody: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    lineHeight: 19,
  },
  dangerBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 12,
    borderRadius: 999,
    borderWidth: 1,
  },
  handoffBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 12,
    borderRadius: 999,
    borderWidth: 1,
  },
  dangerBtnTxt: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  modalScrim: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "flex-end",
  },
  modalSheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: 1,
    padding: 18,
    gap: 14,
    maxHeight: "85%",
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  modalTitle: { fontSize: 17, fontFamily: "Inter_700Bold" },
  modalBody: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    lineHeight: 19,
  },
  targetList: { maxHeight: 240 },
  targetRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 1,
  },
  targetTitle: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  targetSub: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  previewBox: {
    borderRadius: 10,
    borderWidth: 1,
    padding: 12,
    gap: 6,
  },
  previewLine: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    lineHeight: 17,
  },
  impactListLabel: {
    fontSize: 11,
    fontFamily: "Inter_700Bold",
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  impactRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  impactAvatar: {
    width: 22,
    height: 22,
    borderRadius: 11,
  },
  impactAvatarFallback: {
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
  },
  impactRowName: {
    flex: 1,
    fontSize: 12,
    fontFamily: "Inter_500Medium",
  },
  modalActions: {
    flexDirection: "row",
    gap: 10,
  },
  modalCancel: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 999,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  modalConfirm: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
  },
});
