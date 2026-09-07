import React, { useState } from "react";
import {
  Modal,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";

interface Props {
  visible: boolean;
  onClose: () => void;
  isOwner: boolean;
  canEdit: boolean;
  canInvite: boolean;
  onEditProperty: () => void;
  onInvite: () => void;
  onTransferOwnership: () => void;
  onShowWelcomeGuide: () => void;
  onResetWelcomeGuide: () => void;
  welcomeDismissed: boolean;
  propertyName: string;
  notifyJobStarted: boolean | null | undefined;
  notifyJobCompleted: boolean | null | undefined;
  globalNotifyJobStarted: boolean;
  globalNotifyJobCompleted: boolean;
  onChangeNotifyJobStarted: (value: boolean | null) => Promise<void> | void;
  onChangeNotifyJobCompleted: (value: boolean | null) => Promise<void> | void;
}

export function PropertySettingsModal({
  visible,
  onClose,
  isOwner,
  canEdit,
  canInvite,
  onEditProperty,
  onInvite,
  onTransferOwnership,
  onShowWelcomeGuide,
  onResetWelcomeGuide,
  welcomeDismissed,
  propertyName,
  notifyJobStarted,
  notifyJobCompleted,
  globalNotifyJobStarted,
  globalNotifyJobCompleted,
  onChangeNotifyJobStarted,
  onChangeNotifyJobCompleted,
}: Props) {
  const colors = useColors();

  const Row = ({
    icon,
    label,
    description,
    onPress,
  }: {
    icon: React.ComponentProps<typeof Feather>["name"];
    label: string;
    description: string;
    onPress: () => void;
  }) => (
    <Pressable
      onPress={() => {
        onClose();
        // wait for the page-sheet dismiss animation (~350ms on iOS)
        // before presenting the next modal to avoid "Already presenting" errors
        setTimeout(onPress, 400);
      }}
      style={({ pressed }) => [
        styles.row,
        { backgroundColor: colors.card, borderColor: colors.border, opacity: pressed ? 0.7 : 1 },
      ]}
    >
      <View style={[styles.iconWrap, { backgroundColor: colors.primary + "20" }]}>
        <Feather name={icon} size={18} color={colors.primary} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.label, { color: colors.foreground }]}>{label}</Text>
        <Text style={[styles.desc, { color: colors.mutedForeground }]}>{description}</Text>
      </View>
      <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
    </Pressable>
  );

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <TouchableOpacity onPress={onClose}>
            <Text style={[styles.cancel, { color: colors.mutedForeground }]}>Done</Text>
          </TouchableOpacity>
          <Text style={[styles.title, { color: colors.foreground }]}>Property Settings</Text>
          <View style={{ width: 56 }} />
        </View>

        <View style={styles.body}>
          {canEdit ? (
            <Row
              icon="edit-2"
              label="Edit Property"
              description="Change the property photo, name, address, or type."
              onPress={onEditProperty}
            />
          ) : null}

          <Row
            icon="info"
            label="Show Welcome Guide"
            description="Re-open the welcome card with this property's basics, pinned notes, and recent work."
            onPress={onShowWelcomeGuide}
          />

          {welcomeDismissed ? (
            <Row
              icon="rotate-ccw"
              label="Reset Welcome Guide"
              description="Auto-show the welcome card the next time you open this property."
              onPress={onResetWelcomeGuide}
            />
          ) : null}

          {canInvite ? (
            <Row
              icon="user-plus"
              label="Invite to Property"
              description="Add another person so they can contribute based on their role."
              onPress={onInvite}
            />
          ) : null}

          {isOwner ? (
            <Row
              icon="repeat"
              label="Transfer Ownership"
              description="Assign a new Owner. You stay on the property unless removed."
              onPress={onTransferOwnership}
            />
          ) : null}

          <NotificationSection
            colors={colors}
            propertyName={propertyName}
            notifyJobStarted={notifyJobStarted}
            notifyJobCompleted={notifyJobCompleted}
            globalNotifyJobStarted={globalNotifyJobStarted}
            globalNotifyJobCompleted={globalNotifyJobCompleted}
            onChangeNotifyJobStarted={onChangeNotifyJobStarted}
            onChangeNotifyJobCompleted={onChangeNotifyJobCompleted}
          />
        </View>
      </View>
    </Modal>
  );
}

function NotificationSection({
  colors,
  propertyName,
  notifyJobStarted,
  notifyJobCompleted,
  globalNotifyJobStarted,
  globalNotifyJobCompleted,
  onChangeNotifyJobStarted,
  onChangeNotifyJobCompleted,
}: {
  colors: ReturnType<typeof useColors>;
  propertyName: string;
  notifyJobStarted: boolean | null | undefined;
  notifyJobCompleted: boolean | null | undefined;
  globalNotifyJobStarted: boolean;
  globalNotifyJobCompleted: boolean;
  onChangeNotifyJobStarted: (value: boolean | null) => Promise<void> | void;
  onChangeNotifyJobCompleted: (value: boolean | null) => Promise<void> | void;
}) {
  const [optimisticStarted, setOptimisticStarted] = useState<
    boolean | null | undefined
  >(undefined);
  const [optimisticCompleted, setOptimisticCompleted] = useState<
    boolean | null | undefined
  >(undefined);

  const startedOverride =
    optimisticStarted !== undefined ? optimisticStarted : notifyJobStarted ?? null;
  const completedOverride =
    optimisticCompleted !== undefined ? optimisticCompleted : notifyJobCompleted ?? null;

  const startedEffective =
    startedOverride === null ? globalNotifyJobStarted : startedOverride;
  const completedEffective =
    completedOverride === null ? globalNotifyJobCompleted : completedOverride;

  async function applyStarted(next: boolean) {
    // Toggle: if matches global, set to null (inherit); else explicit override.
    const value: boolean | null = next === globalNotifyJobStarted ? null : next;
    setOptimisticStarted(value);
    try {
      await onChangeNotifyJobStarted(value);
    } catch {
      setOptimisticStarted(undefined);
    }
  }
  async function applyCompleted(next: boolean) {
    const value: boolean | null = next === globalNotifyJobCompleted ? null : next;
    setOptimisticCompleted(value);
    try {
      await onChangeNotifyJobCompleted(value);
    } catch {
      setOptimisticCompleted(undefined);
    }
  }

  const Row = ({
    title,
    subtitle,
    value,
    onValueChange,
    overridden,
    showDivider,
  }: {
    title: string;
    subtitle: string;
    value: boolean;
    onValueChange: (v: boolean) => void;
    overridden: boolean;
    showDivider?: boolean;
  }) => (
    <View
      style={{
        paddingVertical: 12,
        paddingHorizontal: 14,
        borderBottomWidth: showDivider ? StyleSheet.hairlineWidth : 0,
        borderBottomColor: colors.border,
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
      }}
    >
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <Text style={{ color: colors.foreground, fontSize: 14, fontFamily: "Inter_600SemiBold" }}>
            {title}
          </Text>
          {overridden ? (
            <View
              style={{
                paddingHorizontal: 6,
                paddingVertical: 2,
                borderRadius: 4,
                backgroundColor: colors.primary + "20",
              }}
            >
              <Text
                style={{
                  fontSize: 9,
                  fontFamily: "Inter_700Bold",
                  color: colors.primary,
                  letterSpacing: 0.5,
                }}
              >
                OVERRIDE
              </Text>
            </View>
          ) : null}
        </View>
        <Text style={{ color: colors.mutedForeground, fontSize: 12, marginTop: 2 }}>
          {subtitle}
        </Text>
      </View>
      <Switch value={value} onValueChange={onValueChange} />
    </View>
  );

  return (
    <View style={{ marginTop: 4, gap: 8 }}>
      <Text
        style={{
          fontSize: 11,
          fontFamily: "Inter_700Bold",
          letterSpacing: 0.8,
          color: colors.mutedForeground,
          marginTop: 8,
          marginLeft: 4,
        }}
      >
        ALERTS FOR THIS PROPERTY
      </Text>
      <View
        style={{
          backgroundColor: colors.card,
          borderColor: colors.border,
          borderWidth: 1,
          borderRadius: 12,
          overflow: "hidden",
        }}
      >
        <Row
          title="Job started alerts"
          subtitle={`Get notified when a provider starts a job at ${propertyName}.`}
          value={startedEffective}
          onValueChange={applyStarted}
          overridden={startedOverride !== null}
          showDivider
        />
        <Row
          title="Job completed alerts"
          subtitle={`Get notified when a provider finishes a job at ${propertyName}.`}
          value={completedEffective}
          onValueChange={applyCompleted}
          overridden={completedOverride !== null}
        />
      </View>
      <Text style={{ color: colors.mutedForeground, fontSize: 11, marginLeft: 4 }}>
        These override your global notification settings just for this property.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  cancel: { fontSize: 16, fontFamily: "Inter_400Regular", minWidth: 56 },
  title: { fontSize: 17, fontFamily: "Inter_600SemiBold" },
  body: { padding: 20, gap: 12 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
  },
  iconWrap: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  label: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  desc: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2, lineHeight: 16 },
  note: { padding: 14, borderWidth: 1, borderStyle: "dashed", borderRadius: 10 },
  noteText: { fontSize: 13, fontFamily: "Inter_400Regular", textAlign: "center" },
});
