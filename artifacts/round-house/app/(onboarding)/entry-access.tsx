import React, { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import {
  useListMyEntityInvites,
  useRespondToEntityMembership,
} from "@workspace/api-client-react";
import { EntryStep } from "@/components/EntryStep";
import {
  readEntrySelection,
  relationshipChoices,
  type EntryParams,
} from "@/lib/entry-intake";
import { useColors } from "@/hooks/useColors";
import { useProfile } from "@/lib/profile";
export default function EntryAccessScreen() {
  const selection = readEntrySelection(useLocalSearchParams<EntryParams>());
  const colors = useColors(),
    router = useRouter(),
    profile = useProfile();
  const queryClient = useQueryClient();
  const invites = useListMyEntityInvites(),
    respond = useRespondToEntityMembership();
  const [error, setError] = useState("");
  if (!selection) return <Redirect href="/(onboarding)/entry" />;
  const entityKind =
    selection.entity === "business"
      ? "business"
      : selection.propertyType === "commercial"
        ? "commercial_property"
        : "residential_property";
  const matches = (invites.data?.invites ?? []).filter(
    (invite) => invite.entity?.kind === entityKind,
  );
  const relationship = relationshipChoices(selection.entity).find(
    (c) => c.value === selection.relationship,
  )!.label;
  return (
    <EntryStep
      step={4}
      title={`Connect with your ${selection.entity}`}
      intro={`${relationship} · Choose an invitation from the owner or administrator. Your invitation determines your access.`}
    >
      {invites.isPending ? (
        <ActivityIndicator accessibilityLabel="Loading invitations" />
      ) : null}
      {invites.isError ? (
        <Pressable accessibilityRole="button" onPress={() => invites.refetch()}>
          <Text style={{ color: colors.primary }}>
            Couldn't load invitations. Tap to retry.
          </Text>
        </Pressable>
      ) : null}
      {!invites.isPending && !invites.isError && matches.length === 0 ? (
        <Text
          style={{ color: colors.foreground, fontSize: 16, lineHeight: 24 }}
        >
          No invitations yet. Ask the owner or administrator to invite the email
          address you used to sign in.
        </Text>
      ) : null}
      {matches.map((invite) => (
        <View
          key={invite.id}
          style={{
            padding: 16,
            borderWidth: 1,
            borderColor: colors.border,
            borderRadius: 16,
            gap: 12,
          }}
        >
          <Text style={{ color: colors.foreground, fontSize: 18 }}>
            {invite.entity!.name}
          </Text>
          <Text style={{ color: colors.mutedForeground }}>
            Invited by {invite.inviter?.displayName ?? "the administrator"}
          </Text>
          <Pressable
            accessibilityRole="button"
            disabled={respond.isPending}
            onPress={async () => {
              setError("");
              try {
                await respond.mutateAsync({
                  memberId: invite.id,
                  data: { action: "accept" },
                });
                await Promise.all([
                  profile.refetchModes(),
                  profile.refetchProfile(),
                  profile.refetchOutwardAccounts(),
                ]);
                await queryClient.invalidateQueries({ queryKey: ["/api/entities/mine"] });
                router.replace("/");
              } catch (e) {
                setError(
                  e instanceof Error
                    ? e.message
                    : "Couldn't accept the invitation. Please retry.",
                );
              }
            }}
            style={{
              minHeight: 48,
              alignItems: "center",
              justifyContent: "center",
              borderRadius: 12,
              backgroundColor: colors.primary,
            }}
          >
            <Text style={{ color: colors.primaryForeground }}>
              {respond.isPending ? "Joining…" : "Accept invitation"}
            </Text>
          </Pressable>
        </View>
      ))}
      {error ? (
        <Text accessibilityRole="alert" style={{ color: "#E55" }}>
          {error}
        </Text>
      ) : null}
      <Pressable
        accessibilityRole="button"
        onPress={() => invites.refetch()}
        style={{ minHeight: 48, justifyContent: "center" }}
      >
        <Text style={{ color: colors.primary }}>Refresh invitations</Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        onPress={() => router.replace("/(onboarding)/entry")}
        style={{ minHeight: 48, justifyContent: "center" }}
      >
        <Text style={{ color: colors.primary }}>
          Choose a different space or relationship
        </Text>
      </Pressable>
    </EntryStep>
  );
}
