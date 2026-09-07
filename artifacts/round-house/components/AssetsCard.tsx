import React, { useState } from "react";
import { Alert, Image, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import {
  useListPropertyAssets,
  useCreatePropertyAsset,
  useUpdatePropertyAsset,
  useDeletePropertyAsset,
  type PropertyAsset,
} from "@workspace/api-client-react";
import { AssetEditorModal, type AssetValues } from "@/components/AssetEditorModal";
import { resolveStorageUrl } from "@/lib/uploads";
import { confirm } from "@/lib/confirm";

interface Props {
  propertyId: number;
  canManage: boolean;
}

export function AssetsCard({ propertyId, canManage }: Props) {
  const colors = useColors();
  const assetsQuery = useListPropertyAssets(propertyId);
  const createAsset = useCreatePropertyAsset();
  const updateAsset = useUpdatePropertyAsset();
  const deleteAsset = useDeletePropertyAsset();
  const [editor, setEditor] = useState<{ open: boolean; asset?: PropertyAsset }>({ open: false });

  const assets = (assetsQuery.data?.assets ?? []) as PropertyAsset[];

  async function handleSubmit(values: AssetValues) {
    try {
      if (editor.asset) {
        await updateAsset.mutateAsync({ propertyId, assetId: editor.asset.id, data: values });
      } else {
        await createAsset.mutateAsync({ propertyId, data: values });
      }
      assetsQuery.refetch();
    } catch (e) {
      Alert.alert("Could not save", e instanceof Error ? e.message : "Try again.");
    }
  }

  async function handleDelete(asset: PropertyAsset) {
    // #627: Use the cross-platform confirm helper so the dialog actually
    // surfaces on react-native-web (where bare `Alert.alert` is a no-op
    // stub) and native alike.
    const ok = await confirm({
      title: "Delete asset?",
      message: `Remove ${asset.name}? Work orders connected to this asset will be disconnected.`,
      confirmLabel: "Delete",
      cancelLabel: "Cancel",
      destructive: true,
    });
    if (!ok) return;
    try {
      await deleteAsset.mutateAsync({ propertyId, assetId: asset.id });
      assetsQuery.refetch();
    } catch (e) {
      Alert.alert("Could not delete", e instanceof Error ? e.message : "Try again.");
    }
  }

  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={styles.headerRow}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Feather name="box" size={16} color={colors.foreground} />
          <Text style={[styles.title, { color: colors.foreground }]}>Assets & equipment</Text>
        </View>
        {canManage && (
          <TouchableOpacity
            onPress={() => setEditor({ open: true })}
            style={[styles.addBtn, { borderColor: colors.border }]}
          >
            <Feather name="plus" size={14} color={colors.foreground} />
            <Text style={[styles.addBtnText, { color: colors.foreground }]}>Add</Text>
          </TouchableOpacity>
        )}
      </View>

      {assets.length === 0 ? (
        <Text style={[styles.empty, { color: colors.mutedForeground }]}>
          {canManage
            ? "Track HVAC, plumbing, electrical, and other equipment so work orders can attach to a specific asset and build a service history."
            : "No assets tracked yet."}
        </Text>
      ) : (
        <View style={{ gap: 8, marginTop: 8 }}>
          {assets.map((a) => {
            const photo = a.photoUrl ? resolveStorageUrl(a.photoUrl) : null;
            return (
              <TouchableOpacity
                key={a.id}
                onPress={() => canManage && setEditor({ open: true, asset: a })}
                onLongPress={() => canManage && handleDelete(a)}
                style={[styles.assetRow, { borderColor: colors.border }]}
              >
                {photo ? (
                  <Image source={{ uri: photo }} style={styles.thumb} />
                ) : (
                  <View style={[styles.thumb, { backgroundColor: colors.muted, alignItems: "center", justifyContent: "center" }]}>
                    <Feather name="box" size={18} color={colors.mutedForeground} />
                  </View>
                )}
                <View style={{ flex: 1 }}>
                  <Text style={[styles.assetName, { color: colors.foreground }]}>{a.name}</Text>
                  <Text style={[styles.assetMeta, { color: colors.mutedForeground }]} numberOfLines={1}>
                    {[a.assetTag, a.category, a.location].filter(Boolean).join(" • ") || "—"}
                  </Text>
                </View>
                {canManage && <Feather name="chevron-right" size={16} color={colors.mutedForeground} />}
              </TouchableOpacity>
            );
          })}
        </View>
      )}

      <AssetEditorModal
        visible={editor.open}
        title={editor.asset ? "Edit asset" : "New asset"}
        initial={
          editor.asset
            ? {
                name: editor.asset.name,
                assetTag: editor.asset.assetTag ?? null,
                category: editor.asset.category ?? null,
                location: editor.asset.location ?? null,
                photoUrl: editor.asset.photoUrl ?? null,
                notes: editor.asset.notes ?? "",
              }
            : undefined
        }
        onClose={() => setEditor({ open: false })}
        onSubmit={handleSubmit}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 14, padding: 14, marginBottom: 12 },
  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  title: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  addBtn: { flexDirection: "row", gap: 4, alignItems: "center", borderWidth: 1, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 14 },
  addBtnText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  empty: { fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 8, lineHeight: 18 },
  assetRow: { flexDirection: "row", alignItems: "center", gap: 10, padding: 10, borderRadius: 12, borderWidth: 1 },
  thumb: { width: 48, height: 48, borderRadius: 8, backgroundColor: "#0002" },
  assetName: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  assetMeta: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
});
