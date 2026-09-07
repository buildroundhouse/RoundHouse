import React from "react";
import { Platform, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { Stack } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetAssignedToMeQueryKey,
  getGetUnreadWorkOrderCommentCountsQueryKey,
  getListMyWorkOrdersQueryKey,
  useGetAssignedToMe,
  useListMyWorkOrders,
} from "@workspace/api-client-react";
import { useColors } from "@/hooks/useColors";
import { MyJobsView } from "@/components/MyJobsView";
import { TopBarAccountIdentity } from "@/components/TopBarAvatar";

export default function MyJobsScreen({
  embedded = false,
}: { embedded?: boolean } = {}) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const { data, isRefetching } = useGetAssignedToMe();
  const myWorkOrdersQuery = useListMyWorkOrders();
  const logsTotal = data?.total ?? 0;
  const workOrdersTotal = myWorkOrdersQuery.data?.workOrders.length ?? 0;
  const total = logsTotal + workOrdersTotal;
  const bottomPad = embedded
    ? 24
    : Platform.OS === "web"
      ? 34 + 24
      : insets.bottom + 24;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {embedded ? null : (
        <Stack.Screen
          options={{
            title: "My Jobs",
            headerStyle: { backgroundColor: colors.background },
            headerTintColor: colors.foreground,
            headerShadowVisible: false,
            headerTitleAlign: "left",
            headerTitle: () => (
              <View style={{ flex: 1, maxWidth: 280 }}>
                <TopBarAccountIdentity />
              </View>
            ),
          }}
        />
      )}
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: bottomPad }]}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={() => {
              queryClient.invalidateQueries({ queryKey: getGetAssignedToMeQueryKey() });
              queryClient.invalidateQueries({ queryKey: getListMyWorkOrdersQueryKey() });
              queryClient.invalidateQueries({ queryKey: getGetUnreadWorkOrderCommentCountsQueryKey() });
            }}
            tintColor={colors.primary}
          />
        }
      >
        <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
          {total} {total === 1 ? "item" : "items"} assigned to you across all properties
          {workOrdersTotal > 0 || logsTotal > 0
            ? ` (${logsTotal} ${logsTotal === 1 ? "job" : "jobs"}, ${workOrdersTotal} ${workOrdersTotal === 1 ? "work order" : "work orders"}).`
            : "."}
        </Text>
        <MyJobsView />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { paddingHorizontal: 20, paddingTop: 12 },
  subtitle: { fontSize: 13, fontFamily: "Inter_400Regular", marginBottom: 4 },
});
