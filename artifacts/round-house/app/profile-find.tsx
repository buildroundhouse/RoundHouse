import React, { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useSearchBusinesses, useListProperties, getSearchBusinessesQueryKey, getListPropertiesQueryKey } from "@workspace/api-client-react";
import { useColors } from "@/hooks/useColors";
import { ProfileRow } from "@/components/CurrentProfileScreen";
import { PublicProfileModal } from "@/components/PublicProfileModal";

export default function ProfileFindScreen() {
  const c = useColors(); const router = useRouter(); const insets = useSafeAreaInsets();
  const { kind } = useLocalSearchParams<{ kind?: string }>();
  const trade = kind !== "home" && kind !== "facility";
  const title = trade ? "Find a Trade Professional" : kind === "home" ? "Residential Home Search" : "Commercial Facility Search";
  const [query, setQuery] = useState(""); const [debounced, setDebounced] = useState(""); const [target, setTarget] = useState<string | null>(null);
  useEffect(() => { const t = setTimeout(() => setDebounced(query.trim()), 300); return () => clearTimeout(t); }, [query]);
  const searchParams = /^\d{5}$/.test(debounced) ? { zip: debounced } : { name: debounced };
  const businesses = useSearchBusinesses(searchParams, { query: { queryKey: getSearchBusinessesQueryKey(searchParams), enabled: trade && debounced.length >= 2 } });
  const properties = useListProperties({ query: { queryKey: getListPropertiesQueryKey(), enabled: !trade } });
  const rows = (properties.data?.properties ?? []).filter(p => {
    const commercial = /commercial|facility|office|retail|warehouse/i.test(p.type);
    return (kind === "facility" ? commercial : !commercial) && `${p.name} ${p.address}`.toLowerCase().includes(debounced.toLowerCase());
  });
  return <View style={{ flex: 1, backgroundColor: c.background }}>
    <Stack.Screen options={{ headerShown: false }}/>
    <Pressable accessibilityRole="button" accessibilityLabel="Back to Profile" onPress={() => router.replace("/(tabs)/profile")} style={{ flexDirection: "row", alignItems: "center", gap: 10, padding: 18, paddingTop: insets.top + 16, minHeight: 56 }}><Feather name="arrow-left" size={24} color={c.foreground}/><Text style={{ color: c.foreground }}>Back to Profile</Text></Pressable>
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 20, gap: 16, paddingBottom: insets.bottom + 40 }}>
      <Text style={{ color: c.foreground, fontWeight: "700", fontSize: 24 }}>{title}</Text>
      <TextInput accessibilityLabel={title} value={query} onChangeText={setQuery} placeholder={trade ? "Name, Business or ZIP" : "Property name or address"} placeholderTextColor={c.mutedForeground} style={{ color: c.foreground, fontSize: 16, borderColor: c.border, borderWidth: 1, borderRadius: 12, padding: 16 }}/>
      {!trade ? <Text style={{ color: c.mutedForeground }}>Search Properties you already have access to. Public opt-in Property discovery is not available yet.</Text> : null}
      {trade && debounced.length < 2 ? <Text style={{ color: c.mutedForeground }}>Enter at least two characters to search.</Text> : null}
      {(trade ? businesses.isFetching : properties.isLoading) ? <ActivityIndicator color={c.primary}/> : null}
      {(trade ? businesses.isError : properties.isError) ? <ProfileRow title="Search could not load. Retry" onPress={() => void (trade ? businesses.refetch() : properties.refetch())}/> : null}
      {trade ? (businesses.data?.businesses ?? []).map(b => <ProfileRow key={b.id} title={b.companyName || b.name} subtitle={[b.name, b.tradeLabel, b.region].filter(Boolean).join(" · ")} onPress={() => setTarget(b.clerkId)}/>) : rows.map(p => <ProfileRow key={p.id} title={p.name} subtitle={p.address} onPress={() => router.push(`/property/${p.id}` as never)}/>)}
      {debounced.length >= 2 && !(trade ? businesses.isFetching || businesses.isError : properties.isLoading || properties.isError) && (trade ? businesses.data?.businesses.length === 0 : rows.length === 0) ? <Text style={{ color: c.mutedForeground }}>No matches found.</Text> : null}
      <ProfileRow title="Invite / Share Roundhouse" subtitle="Invite someone into an appropriate Entity" onPress={() => router.push({ pathname: "/invites", params: { from: "profile", focus: "share" } } as never)}/>
    </ScrollView>
    <PublicProfileModal visible={!!target} clerkId={target} onClose={() => setTarget(null)}/>
  </View>;
}
