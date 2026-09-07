import React, { useMemo, useState } from "react";
import {
  FlatList,
  Image,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { resolveStorageUrl } from "@/lib/uploads";
import { Feather } from "@expo/vector-icons";
import { TopBarAccountIdentity } from "@/components/TopBarAvatar";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import {
  useListProperties,
  useCreateProperty,
  useUpdateProperty,
  useGetOverdueWorkOrderCounts,
  useGetOwnerOverview,
} from "@workspace/api-client-react";
import type { OwnerOverviewProperty } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import { AddPropertyModal } from "@/components/AddPropertyModal";
import { DemoBadge } from "@/components/DemoBadge";
import { EmptyState } from "@/components/EmptyState";
import { PropertiesMapView, type MappableProperty } from "@/components/PropertiesMapView";
import { PickLocationOnMapModal } from "@/components/PickLocationOnMapModal";
import { MapBackfillBanner } from "@/components/MapBackfillBanner";

function formatSnoozeResumes(iso: string | Date | null | undefined): string | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime();
  if (!Number.isFinite(ms)) return null;
  const diffMs = ms - Date.now();
  if (diffMs <= 0) return null;
  const minutes = Math.round(diffMs / (60 * 1000));
  if (minutes < 60) {
    return minutes <= 1 ? "in 1m" : `in ${minutes}m`;
  }
  const target = new Date(ms);
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfTarget = new Date(
    target.getFullYear(),
    target.getMonth(),
    target.getDate(),
  ).getTime();
  const dayDiff = Math.round((startOfTarget - startOfToday) / (24 * 60 * 60 * 1000));
  const timeStr = target
    .toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    .replace(/\s/g, "")
    .toLowerCase();
  if (dayDiff <= 0) return timeStr;
  if (dayDiff === 1) return `tomorrow ${timeStr}`;
  if (dayDiff < 7) {
    const weekday = target.toLocaleDateString([], { weekday: "short" });
    return `${weekday} ${timeStr}`;
  }
  if (dayDiff < 30) return `in ${dayDiff}d`;
  return target.toLocaleDateString([], { month: "short", day: "numeric" });
}

export default function PropertiesScreen({
  embedded = false,
}: { embedded?: boolean } = {}) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const router = useRouter();
  const [showAddProperty, setShowAddProperty] = useState(false);
  const [view, setView] = useState<"list" | "map">("list");
  const [pickOnMapFor, setPickOnMapFor] = useState<{ id: number; name: string } | null>(null);

  const { data, isLoading, refetch, isRefetching } = useListProperties();
  const createProperty = useCreateProperty();
  const updateProperty = useUpdateProperty();
  const overdueQuery = useGetOverdueWorkOrderCounts();
  const overviewQuery = useGetOwnerOverview();

  const properties = data?.properties ?? [];
  const overdueByProp = React.useMemo(() => {
    const m = new Map<number, number>();
    (overdueQuery.data?.counts ?? []).forEach((c) => m.set(c.propertyId, c.overdueCount));
    return m;
  }, [overdueQuery.data]);
  const overviewByProp = React.useMemo(() => {
    const m = new Map<number, OwnerOverviewProperty>();
    (overviewQuery.data?.properties ?? []).forEach((row) => m.set(row.property.id, row));
    return m;
  }, [overviewQuery.data]);

  const { mappable, unmapped } = useMemo(() => {
    const mappable: MappableProperty[] = [];
    const unmapped: typeof properties = [];
    for (const p of properties) {
      if (
        typeof p.latitude === "number" &&
        Number.isFinite(p.latitude) &&
        typeof p.longitude === "number" &&
        Number.isFinite(p.longitude)
      ) {
        mappable.push({
          id: p.id,
          name: p.name,
          address: p.address ?? null,
          latitude: p.latitude,
          longitude: p.longitude,
          coverColor: p.coverColor ?? null,
        });
      } else {
        unmapped.push(p);
      }
    }
    return { mappable, unmapped };
  }, [properties]);

  const topPad = embedded ? 4 : Platform.OS === "web" ? 24 : insets.top + 12;
  const bottomPad = embedded
    ? 24
    : Platform.OS === "web"
      ? 34 + 100
      : insets.bottom + 100;

  const handleAddProperty = async (values: {
    name: string;
    address?: string;
    type?: string;
    coverColor?: string;
    coverPhotoUrl?: string;
    placeId?: string | null;
    latitude?: number | null;
    longitude?: number | null;
  }) => {
    await createProperty.mutateAsync({ data: values });
    queryClient.invalidateQueries({ queryKey: ["/api/properties"] });
    setShowAddProperty(false);
  };

  const openProperty = (id: number) => {
    Haptics.selectionAsync();
    router.push(`/property/${id}` as never);
  };

  const renderPropertyRow = (item: (typeof properties)[number]) => (
    <TouchableOpacity
      key={item.id}
      style={[styles.propertyCard, { backgroundColor: colors.card, borderColor: colors.border }]}
      activeOpacity={0.85}
      onPress={() => openProperty(item.id)}
    >
      {item.coverPhotoUrl ? (
        <Image
          source={{ uri: resolveStorageUrl(item.coverPhotoUrl) ?? undefined }}
          style={styles.cardPhoto}
        />
      ) : (
        <View style={[styles.cardAccent, { backgroundColor: item.coverColor || colors.primary }]} />
      )}
      <View style={styles.cardContent}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <Text style={[styles.cardName, { color: colors.foreground }]}>{item.name}</Text>
          {(item as { isAdminDemo?: boolean }).isAdminDemo ? (
            <DemoBadge size="sm" />
          ) : null}
        </View>
        {item.address ? (
          <Text style={[styles.cardAddress, { color: colors.mutedForeground }]}>{item.address}</Text>
        ) : null}
        {(() => {
          const mapped =
            typeof item.latitude === "number" &&
            Number.isFinite(item.latitude) &&
            typeof item.longitude === "number" &&
            Number.isFinite(item.longitude);
          const hasAddress = !!item.address && item.address.trim().length > 0;
          if (!mapped && !hasAddress) return null;
          const label = mapped ? "Mapped" : "Address only";
          const icon = mapped ? "map-pin" : "type";
          const tint = mapped ? colors.primary : colors.mutedForeground;
          return (
            <View
              style={[
                styles.locationBadge,
                { backgroundColor: colors.muted, borderColor: colors.border },
              ]}
              accessibilityLabel={mapped ? "Property location is mapped" : "Property has address only"}
            >
              <Feather name={icon as any} size={10} color={tint} />
              <Text style={[styles.locationBadgeText, { color: tint }]}>{label}</Text>
            </View>
          );
        })()}
        <View style={styles.cardMeta}>
          <View style={[styles.roleBadge, { backgroundColor: colors.scoreBackground }]}>
            <Text style={[styles.roleText, { color: colors.primary }]}>{item.userRole}</Text>
          </View>
          <Text style={[styles.memberCount, { color: colors.mutedForeground }]}>
            {item.members.length} {item.members.length === 1 ? "member" : "members"}
          </Text>
          {(() => {
            const ov = overviewByProp.get(item.id);
            const overdueCount = overdueByProp.get(item.id) ?? 0;
            const overdueStandards = ov?.overdueStandards ?? 0;
            const mutedOverdue = ov?.mutedOverdueStandards ?? 0;
            const snoozedStandards = ov?.snoozedStandards ?? 0;
            const earliestSnoozeUntil = ov?.earliestSnoozeUntil ?? null;
            const snoozeResumesText = formatSnoozeResumes(earliestSnoozeUntil);
            const propertyMuted = !!ov?.standardsAlertsMuted;
            const muteResumesText = formatSnoozeResumes(ov?.standardsMutedUntil ?? null);
            return (
              <>
                {overdueCount > 0 && (
                  <View style={styles.overdueBadge}>
                    <Feather name="alert-circle" size={11} color="#FFFFFF" />
                    <Text style={styles.overdueBadgeText}>{overdueCount} overdue</Text>
                  </View>
                )}
                {overdueStandards > 0 && (
                  <View style={styles.overdueBadge}>
                    <Feather name="alert-triangle" size={11} color="#FFFFFF" />
                    <Text style={styles.overdueBadgeText}>
                      {overdueStandards} drift
                    </Text>
                  </View>
                )}
                {propertyMuted ? (
                  <View
                    style={[
                      styles.mutedBadge,
                      { backgroundColor: colors.muted, borderColor: colors.border },
                    ]}
                    accessibilityLabel={
                      muteResumesText
                        ? `Standards alerts muted, resumes ${muteResumesText}${mutedOverdue > 0 ? `, ${mutedOverdue} paused` : ""}`
                        : mutedOverdue > 0
                          ? `Standards alerts muted, ${mutedOverdue} paused`
                          : "Standards alerts muted"
                    }
                  >
                    <Feather name="bell-off" size={11} color={colors.mutedForeground} />
                    <Text style={[styles.mutedBadgeText, { color: colors.mutedForeground }]}>
                      {mutedOverdue > 0 ? `Muted · ${mutedOverdue} paused` : "Muted"}
                      {muteResumesText ? ` · resumes ${muteResumesText}` : ""}
                    </Text>
                  </View>
                ) : snoozedStandards > 0 ? (
                  <TouchableOpacity
                    style={[
                      styles.snoozedBadge,
                      { backgroundColor: colors.scoreBackground, borderColor: colors.scoreBackground },
                    ]}
                    onPress={(e) => {
                      e.stopPropagation();
                      Haptics.selectionAsync();
                      router.push(`/property/${item.id}?tab=standards` as never);
                    }}
                    accessibilityLabel={
                      snoozeResumesText
                        ? `${snoozedStandards} snoozed standard${snoozedStandards === 1 ? "" : "s"}, soonest resumes ${snoozeResumesText}, tap to view`
                        : `${snoozedStandards} snoozed standard${snoozedStandards === 1 ? "" : "s"}, tap to view`
                    }
                  >
                    <Feather name="clock" size={11} color={colors.score} />
                    <Text style={[styles.snoozedBadgeText, { color: colors.score }]}>
                      {snoozedStandards} snoozed
                      {snoozeResumesText ? ` · resumes ${snoozeResumesText}` : ""}
                    </Text>
                  </TouchableOpacity>
                ) : null}
              </>
            );
          })()}
        </View>
      </View>
      <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
    </TouchableOpacity>
  );

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: topPad, borderBottomColor: colors.border }]}>
        {embedded ? null : <TopBarAccountIdentity />}
        <Text style={[styles.headerSub, { color: colors.mutedForeground }]}>
          {properties.length} {properties.length === 1 ? "property" : "properties"}
        </Text>
        <View style={[styles.toggle, { backgroundColor: colors.muted, borderColor: colors.border }]}>
          <TouchableOpacity
            style={[
              styles.toggleBtn,
              view === "list" && { backgroundColor: colors.card },
            ]}
            onPress={() => {
              Haptics.selectionAsync();
              setView("list");
            }}
            accessibilityLabel="Show list view"
            accessibilityState={{ selected: view === "list" }}
          >
            <Feather
              name="list"
              size={16}
              color={view === "list" ? colors.foreground : colors.mutedForeground}
            />
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.toggleBtn,
              view === "map" && { backgroundColor: colors.card },
            ]}
            onPress={() => {
              Haptics.selectionAsync();
              setView("map");
            }}
            accessibilityLabel="Show map view"
            accessibilityState={{ selected: view === "map" }}
          >
            <Feather
              name="map"
              size={16}
              color={view === "map" ? colors.foreground : colors.mutedForeground}
            />
          </TouchableOpacity>
        </View>
        <TouchableOpacity
          style={[styles.addBtn, { backgroundColor: colors.primary }]}
          onPress={() => {
            Haptics.selectionAsync();
            setShowAddProperty(true);
          }}
        >
          <Feather name="plus" size={20} color={colors.primaryForeground} />
        </TouchableOpacity>
      </View>

      {view === "list" ? (
        <FlatList
          data={properties}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={[
            styles.list,
            { paddingBottom: bottomPad },
            properties.length === 0 && styles.listEmpty,
          ]}
          refreshControl={
            <RefreshControl
              refreshing={isRefetching || overviewQuery.isRefetching || overdueQuery.isRefetching}
              onRefresh={() => {
                refetch();
                overviewQuery.refetch();
                overdueQuery.refetch();
              }}
              tintColor={colors.primary}
            />
          }
          renderItem={({ item }) => renderPropertyRow(item)}
          ListEmptyComponent={
            !isLoading ? (
              <EmptyState
                icon="home"
                title="No properties yet"
                description="Create a property profile to start logging work and building a shared record."
                actionLabel="Create Property Profile"
                onAction={() => setShowAddProperty(true)}
              />
            ) : null
          }
        />
      ) : (
        <View style={{ flex: 1 }}>
          <View style={styles.mapContainer}>
            <PropertiesMapView properties={mappable} onPressMarker={openProperty} />
          </View>
          {unmapped.length > 0 && (
            <ScrollView
              style={[styles.unmappedSheet, { backgroundColor: colors.background, borderTopColor: colors.border }]}
              contentContainerStyle={{ paddingBottom: bottomPad, padding: 16, gap: 8 }}
            >
              <View style={styles.unmappedHeader}>
                <Feather name="map-pin" size={14} color={colors.mutedForeground} />
                <Text style={[styles.unmappedTitle, { color: colors.mutedForeground }]}>
                  Not on map ({unmapped.length})
                </Text>
              </View>
              <Text style={[styles.unmappedHint, { color: colors.mutedForeground }]}>
                These properties don't have saved coordinates. Drop a pin manually or edit the property to pick an address.
              </Text>
              {unmapped.map((p) => (
                <View key={p.id} style={styles.unmappedRow}>
                  {renderPropertyRow(p)}
                  {p.address ? (
                    <View style={styles.unmappedActionsInline}>
                      <MapBackfillBanner
                        propertyId={p.id}
                        address={p.address}
                        onDone={() => {
                          refetch();
                        }}
                      />
                    </View>
                  ) : null}
                  <TouchableOpacity
                    style={[
                      styles.pickOnMapInline,
                      { backgroundColor: colors.scoreBackground, borderColor: colors.border },
                    ]}
                    onPress={() => {
                      Haptics.selectionAsync();
                      setPickOnMapFor({ id: p.id, name: p.name });
                    }}
                    accessibilityLabel={`Pick location on map for ${p.name}`}
                  >
                    <Feather name="map-pin" size={14} color={colors.primary} />
                    <Text style={[styles.pickOnMapInlineText, { color: colors.primary }]}>
                      Pick on map
                    </Text>
                  </TouchableOpacity>
                </View>
              ))}
            </ScrollView>
          )}
        </View>
      )}

      <AddPropertyModal
        visible={showAddProperty}
        onClose={() => setShowAddProperty(false)}
        onSubmit={handleAddProperty}
      />

      <PickLocationOnMapModal
        visible={!!pickOnMapFor}
        onClose={() => setPickOnMapFor(null)}
        title={pickOnMapFor ? `Pick on map · ${pickOnMapFor.name}` : "Pick on map"}
        onSave={async (lat, lng) => {
          if (!pickOnMapFor) return;
          await updateProperty.mutateAsync({
            propertyId: pickOnMapFor.id,
            data: { latitude: lat, longitude: lng },
          });
          await refetch();
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 8,
    paddingHorizontal: 16,
    paddingBottom: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  title: { fontSize: 28, fontFamily: "Inter_700Bold" },
  headerSub: { fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 2 },
  toggle: {
    flexDirection: "row",
    borderRadius: 10,
    borderWidth: 1,
    padding: 2,
    gap: 2,
  },
  toggleBtn: {
    width: 36,
    height: 32,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  addBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
  },
  list: { paddingHorizontal: 16, paddingTop: 16, gap: 12 },
  listEmpty: { flex: 1 },
  mapContainer: { flex: 1, overflow: "hidden" },
  unmappedSheet: {
    maxHeight: "45%",
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  unmappedHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  unmappedTitle: { fontSize: 12, fontFamily: "Inter_600SemiBold", textTransform: "uppercase", letterSpacing: 0.5 },
  unmappedHint: { fontSize: 12, fontFamily: "Inter_400Regular", marginBottom: 4 },
  propertyCard: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 14,
    borderWidth: 1,
    overflow: "hidden",
  },
  cardAccent: { width: 6, alignSelf: "stretch" },
  cardPhoto: { width: 76, alignSelf: "stretch" },
  cardContent: { flex: 1, padding: 14, gap: 4 },
  cardName: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
  cardAddress: { fontSize: 13, fontFamily: "Inter_400Regular" },
  cardMeta: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 4 },
  locationBadge: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 10,
    borderWidth: 1,
    marginTop: 4,
  },
  locationBadgeText: { fontSize: 10, fontFamily: "Inter_600SemiBold" },
  roleBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20 },
  roleText: { fontSize: 11, fontFamily: "Inter_600SemiBold", textTransform: "capitalize" },
  memberCount: { fontSize: 12, fontFamily: "Inter_400Regular" },
  overdueBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "#B0413E",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
  },
  overdueBadgeText: { fontSize: 11, fontFamily: "Inter_700Bold", color: "#FFFFFF" },
  mutedBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    borderWidth: 1,
  },
  mutedBadgeText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  snoozedBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    borderWidth: 1,
  },
  snoozedBadgeText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  unmappedRow: { gap: 6 },
  unmappedActionsInline: { marginLeft: 4, marginRight: 4 },
  pickOnMapInline: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    marginLeft: 4,
  },
  pickOnMapInlineText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
});
