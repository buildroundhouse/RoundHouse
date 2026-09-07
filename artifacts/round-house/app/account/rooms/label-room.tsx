import React from "react";
import { Text, View } from "react-native";
import { useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { ADMIN_THEME, ROOMS } from "@/lib/adminTheme";
import {
  BrassButton,
  RoomShell,
  VelvetCard,
} from "@/components/admin/RoomShell";

const SETS = [
  { key: "home_priorities", label: "Home priorities", color: "#7BC0A8" },
  { key: "maintenance_focus", label: "Maintenance focus", color: "#C8A24A" },
  { key: "trades", label: "Trades", color: "#C95F4A" },
  { key: "service_categories", label: "Service categories", color: "#7E5BC0" },
  { key: "wo_categories", label: "Work-order categories", color: "#5BA0C0" },
  { key: "wo_priorities", label: "Work-order priorities", color: "#C0905B" },
  { key: "tokens", label: "Tokens", color: "#C04A8C" },
  { key: "titles", label: "Titles", color: "#5BC07E" },
];

export default function LabelRoomLanding() {
  const router = useRouter();
  const room = ROOMS.label;
  return (
    <RoomShell
      title={room.title}
      marquee="Atelier"
      tagline={room.tagline}
      bgGrad={room.bgGrad}
      accent={room.accent}
      glow={room.glow}
      icon={room.icon}
    >
      <VelvetCard accent={room.accent}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <Feather name="grid" size={18} color={room.accent} />
          <Text
            style={{
              color: ADMIN_THEME.bone,
              fontSize: 15,
              fontWeight: "800",
              letterSpacing: 1,
            }}
          >
            SWATCH WALL
          </Text>
        </View>
        <Text style={{ color: ADMIN_THEME.ash, fontSize: 12, lineHeight: 17 }}>
          Every permanent label set in the house. Pin a new chip, send one to
          the scrap drawer, or pull one back.
        </Text>

        <View
          style={{
            flexDirection: "row",
            flexWrap: "wrap",
            gap: 10,
            marginTop: 10,
          }}
        >
          {SETS.map((set) => (
            <View
              key={set.key}
              style={{
                width: "47%",
                borderRadius: 8,
                borderWidth: 1,
                borderColor: room.accent + "55",
                backgroundColor: "rgba(244,236,215,0.04)",
                padding: 10,
                gap: 8,
              }}
            >
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                <View
                  style={{
                    width: 14,
                    height: 14,
                    borderRadius: 3,
                    backgroundColor: set.color,
                    borderWidth: 1,
                    borderColor: room.accent,
                  }}
                />
                <Text
                  style={{
                    color: ADMIN_THEME.bone,
                    fontSize: 12,
                    fontWeight: "700",
                    flex: 1,
                  }}
                  numberOfLines={1}
                >
                  {set.label}
                </Text>
              </View>
              <Text
                style={{
                  color: ADMIN_THEME.ash,
                  fontSize: 10,
                  letterSpacing: 1,
                }}
              >
                — chips
              </Text>
            </View>
          ))}
        </View>
      </VelvetCard>

      <VelvetCard accent={room.accent}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <Feather name="archive" size={18} color={room.accent} />
          <Text
            style={{
              color: ADMIN_THEME.bone,
              fontSize: 15,
              fontWeight: "800",
              letterSpacing: 1,
            }}
          >
            SCRAP DRAWER
          </Text>
        </View>
        <Text style={{ color: ADMIN_THEME.ash, fontSize: 12, lineHeight: 17 }}>
          Retired chips live here. Hidden from new pickers; existing assignments
          keep showing the label they had.
        </Text>
      </VelvetCard>

      <BrassButton
        label="Open the workshop"
        onPress={() => router.push("/account/preset-chips")}
        accent={room.accent}
        icon="arrow-right"
      />
    </RoomShell>
  );
}
