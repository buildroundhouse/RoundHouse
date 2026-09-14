import React from "react";
import { ActivityIndicator, Image, Modal, Pressable, ScrollView, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { useColors } from "@/hooks/useColors";
import { useProfile } from "@/lib/profile";
import { resolveStorageUrl } from "@/lib/uploads";
import { formatOwnerNameForSkin } from "@/lib/ownerNameDisplay";
import { PERSONAL_FIELDS, personalDetailsFromIntake, profileContext, type ProfileEntity } from "@/lib/personal-profile";
import { ProfileNavigation } from "./ProfileNavigation";

/** Every self-preview doorway uses the same current personal fields and visibility. */
export function ProfilePreview({ visible, onClose, onExit }: { visible: boolean; onClose: () => void; onExit?: () => void }) {
  const c = useColors(); const insets = useSafeAreaInsets(); const router = useRouter();
  const { profile, activeMode, activeOutwardAccount } = useProfile();
  const accountId = activeOutwardAccount?.id;
  const entities = useQuery({ queryKey: ["/api/entities/mine", accountId], enabled: visible && !!accountId,
    queryFn: () => customFetch<{ entities: ProfileEntity[] }>("/api/entities/mine") });
  const md = (activeMode?.intakeData ?? {}) as Record<string, unknown>;
  const details = personalDetailsFromIntake(md);
  const { role, entityName } = profileContext(activeMode?.kind, md, entities.data?.entities ?? []);
  const avatar = resolveStorageUrl(profile?.avatarUrl);
  const banner = resolveStorageUrl(typeof md.profileBannerUrl === "string" ? md.profileBannerUrl : null);
  const publicFields = PERSONAL_FIELDS.filter(({ key }) => details[key]?.public && details[key]?.value);
  return <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <ProfileNavigation title="View Profile" onExit={() => { onClose(); if (onExit) onExit(); else router.replace("/(tabs)"); }}/>
      <ScrollView contentContainerStyle={{ padding: 20, gap: 18, paddingBottom: insets.bottom + 40 }}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back to Profile" onPress={onClose} style={{ minHeight: 48, justifyContent: "center" }}>
          <Text style={{ color: c.primary }}>Back to Profile</Text>
        </Pressable>
        {banner ? <Image source={{ uri: banner }} style={{ width: "100%", height: 150, borderRadius: 12 }}/> : null}
        {avatar ? <Image source={{ uri: avatar }} style={{ width: 90, height: 90, borderRadius: 45 }}/> : null}
        <Text testID="full-profile-display-name" style={{ color: c.foreground, fontSize: 23, fontWeight: "700" }}>{formatOwnerNameForSkin(profile?.name, activeOutwardAccount?.lastInitialOnly) || "Your profile"}</Text>
        <Text style={{ color: c.foreground }}>{role}</Text>
        {entities.isLoading ? <ActivityIndicator/> : entities.isError ? <Text style={{ color: c.mutedForeground }}>Entity context is unavailable.</Text> : <Text style={{ color: c.mutedForeground }}>{entityName}</Text>}
        {publicFields.map(({ key, label }) => <View key={key} style={{ gap: 7 }}>
          <Text style={{ color: c.foreground, fontWeight: "600" }}>{label}</Text><Text style={{ color: c.foreground }}>{details[key]?.value}</Text>
        </View>)}
        {!publicFields.length ? <Text style={{ color: c.mutedForeground }}>No personal information has been made public.</Text> : null}
      </ScrollView>
    </View>
  </Modal>;
}
