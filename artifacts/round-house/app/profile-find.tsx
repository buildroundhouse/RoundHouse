import React, { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { customFetch, useSearchBusinesses, useListProperties, getSearchBusinessesQueryKey, getListPropertiesQueryKey } from "@workspace/api-client-react";
import { useColors } from "@/hooks/useColors";
import { ProfileRow } from "@/components/CurrentProfileScreen";
import { PublicProfileModal } from "@/components/PublicProfileModal";
import { FoundYourBusinessModal } from "@/components/FoundYourBusinessCard";

type BusinessEntity = {
  id: number;
  kind: "business";
  displayName: string;
  companyName?: string | null;
  tagline?: string | null;
};

type BusinessEntitySearchResponse = { entities: BusinessEntity[] };

export default function ProfileFindScreen() {
  const c = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const { kind } = useLocalSearchParams<{ kind?: string }>();
  const trade = kind !== "home" && kind !== "facility";
  const title = trade
    ? "Find a Trade Professional"
    : kind === "home"
      ? "Residential Home Search"
      : "Commercial Facility Search";

  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [target, setTarget] = useState<string | null>(null);
  const [createBusinessOpen, setCreateBusinessOpen] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 300);
    return () => clearTimeout(t);
  }, [query]);

  const searchParams = /^\d{5}$/.test(debounced) ? { zip: debounced } : { name: debounced };
  const businesses = useSearchBusinesses(searchParams, {
    query: {
      queryKey: getSearchBusinessesQueryKey(searchParams),
      enabled: trade && debounced.length >= 2,
    },
  });

  const businessEntities = useQuery({
    enabled: trade && debounced.length >= 2 && !/^\d{5}$/.test(debounced),
    queryKey: ["/api/entity-setup/business/search", debounced],
    queryFn: () =>
      customFetch<BusinessEntitySearchResponse>(
        `/api/entity-setup/business/search?q=${encodeURIComponent(debounced)}`,
      ),
  });

  const properties = useListProperties({
    query: { queryKey: getListPropertiesQueryKey(), enabled: !trade },
  });

  const rows = (properties.data?.properties ?? []).filter((p) => {
    const commercial = /commercial|facility|office|retail|warehouse/i.test(p.type);
    return (
      (kind === "facility" ? commercial : !commercial) &&
      `${p.name} ${p.address}`.toLowerCase().includes(debounced.toLowerCase())
    );
  });

  const entityRows = businessEntities.data?.entities ?? [];
  const proRows = businesses.data?.businesses ?? [];
  const tradeLoading = businesses.isFetching || businessEntities.isFetching;
  const tradeError = businesses.isError || businessEntities.isError;
  const noTradeMatch = debounced.length >= 2 && !tradeLoading && !tradeError && entityRows.length === 0 && proRows.length === 0;

  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <Stack.Screen options={{ headerShown: false }} />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Back to Profile"
        onPress={() => router.replace("/(tabs)/profile")}
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 10,
          padding: 18,
          paddingTop: insets.top + 16,
          minHeight: 56,
        }}
      >
        <Feather name="arrow-left" size={24} color={c.foreground} />
        <Text style={{ color: c.foreground }}>Back to Profile</Text>
      </Pressable>

      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: 20, gap: 16, paddingBottom: insets.bottom + 40 }}
      >
        <Text style={{ color: c.foreground, fontWeight: "700", fontSize: 24 }}>{title}</Text>
        <TextInput
          accessibilityLabel={title}
          value={query}
          onChangeText={setQuery}
          placeholder={trade ? "Name, Business or ZIP" : "Property name or address"}
          placeholderTextColor={c.mutedForeground}
          style={{
            color: c.foreground,
            fontSize: 16,
            borderColor: c.border,
            borderWidth: 1,
            borderRadius: 12,
            padding: 16,
          }}
        />

        {!trade ? (
          <Text style={{ color: c.mutedForeground }}>
            Search Properties you already have access to. Public opt-in Property discovery is not available yet.
          </Text>
        ) : null}
        {trade && debounced.length < 2 ? (
          <Text style={{ color: c.mutedForeground }}>Enter at least two characters to search.</Text>
        ) : null}

        {(trade ? tradeLoading : properties.isLoading) ? <ActivityIndicator color={c.primary} /> : null}
        {(trade ? tradeError : properties.isError) ? (
          <ProfileRow
            title="Search could not load. Retry"
            onPress={() => {
              if (trade) {
                void businesses.refetch();
                void businessEntities.refetch();
              } else {
                void properties.refetch();
              }
            }}
          />
        ) : null}

        {trade ? (
          <>
            {entityRows.map((entity) => (
              <View
                key={`entity-${entity.id}`}
                style={{
                  borderWidth: 1,
                  borderColor: c.border,
                  borderRadius: 12,
                  padding: 14,
                  gap: 4,
                  backgroundColor: c.card,
                }}
              >
                <Text style={{ color: c.foreground, fontWeight: "700" }}>
                  {entity.displayName || entity.companyName || "Business"}
                </Text>
                <Text style={{ color: c.mutedForeground }}>Business Entity</Text>
                {entity.tagline ? <Text style={{ color: c.mutedForeground }}>{entity.tagline}</Text> : null}
              </View>
            ))}

            {proRows.map((b) => (
              <ProfileRow
                key={`pro-${b.id}`}
                title={b.companyName || b.name}
                subtitle={[b.name, b.tradeLabel, b.region].filter(Boolean).join(" · ")}
                onPress={() => setTarget(b.clerkId)}
              />
            ))}

            {noTradeMatch ? (
              <>
                <Text style={{ color: c.mutedForeground }}>No matches found.</Text>
                <ProfileRow
                  title={`+ Add ${debounced}`}
                  subtitle="Create this as a Business Entity"
                  icon="plus"
                  onPress={() => setCreateBusinessOpen(true)}
                />
              </>
            ) : null}
          </>
        ) : (
          rows.map((p) => (
            <ProfileRow
              key={p.id}
              title={p.name}
              subtitle={p.address}
              onPress={() => router.push(`/property/${p.id}` as never)}
            />
          ))
        )}

        {!trade &&
        debounced.length >= 2 &&
        !properties.isLoading &&
        !properties.isError &&
        rows.length === 0 ? (
          <Text style={{ color: c.mutedForeground }}>No matches found.</Text>
        ) : null}

        <ProfileRow
          title="Invite / Share Roundhouse"
          subtitle="Invite someone into an appropriate Entity"
          onPress={() => router.push({ pathname: "/invites", params: { from: "profile", focus: "share" } } as never)}
        />
      </ScrollView>

      <PublicProfileModal visible={!!target} clerkId={target} onClose={() => setTarget(null)} />
      <FoundYourBusinessModal
        visible={createBusinessOpen}
        initialName={debounced || query.trim()}
        onClose={() => setCreateBusinessOpen(false)}
        onCreated={() => {
          setCreateBusinessOpen(false);
          void queryClient.invalidateQueries({ queryKey: ["/api/entities/mine"] });
          void queryClient.invalidateQueries({ queryKey: ["/api/entity-setup/business/search"] });
          void businessEntities.refetch();
        }}
      />
    </View>
  );
}
