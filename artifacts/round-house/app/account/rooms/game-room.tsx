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

export default function GameRoomLanding() {
  const router = useRouter();
  const room = ROOMS.game;
  return (
    <RoomShell
      title={room.title}
      marquee="Insert coin"
      tagline={room.tagline}
      bgGrad={room.bgGrad}
      accent={room.accent}
      glow={room.glow}
      icon={room.icon}
    >
      <View style={{ flexDirection: "row", gap: 12 }}>
        {[
          { label: "POINTS", value: "—" },
          { label: "PLAYERS", value: "—" },
          { label: "PRIZES", value: "—" },
        ].map((stat) => (
          <View key={stat.label} style={{ flex: 1 }}>
            <VelvetCard accent={room.accent}>
              <Text
                style={{
                  color: room.accent,
                  fontSize: 10,
                  fontWeight: "800",
                  letterSpacing: 2,
                }}
              >
                {stat.label}
              </Text>
              <Text
                style={{
                  color: ADMIN_THEME.bone,
                  fontSize: 30,
                  fontWeight: "900",
                  fontVariant: ["tabular-nums"],
                  letterSpacing: 1,
                }}
              >
                {stat.value}
              </Text>
            </VelvetCard>
          </View>
        ))}
      </View>

      <VelvetCard accent={room.accent}>
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 10,
          }}
        >
          <Feather name="sliders" size={18} color={room.accent} />
          <Text
            style={{
              color: ADMIN_THEME.bone,
              fontSize: 16,
              fontWeight: "800",
              letterSpacing: 1,
            }}
          >
            SCORE CONTROLS
          </Text>
        </View>
        <Text style={{ color: ADMIN_THEME.ash, fontSize: 13, lineHeight: 18 }}>
          Tune the points awarded for each event in the game. Edits take
          effect immediately across every player's ledger.
        </Text>
      </VelvetCard>

      <VelvetCard accent={room.accent}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <Feather name="award" size={18} color={room.accent} />
          <Text
            style={{
              color: ADMIN_THEME.bone,
              fontSize: 16,
              fontWeight: "800",
              letterSpacing: 1,
            }}
          >
            HIGH SCORES
          </Text>
        </View>
        <Text style={{ color: ADMIN_THEME.ash, fontSize: 13, lineHeight: 18 }}>
          Live ranked board of every player by total points. Tap a name to
          drill into their full activity history.
        </Text>
      </VelvetCard>

      <VelvetCard accent={room.accent}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <Feather name="gift" size={18} color={room.accent} />
          <Text
            style={{
              color: ADMIN_THEME.bone,
              fontSize: 16,
              fontWeight: "800",
              letterSpacing: 1,
            }}
          >
            PRIZE CLAW
          </Text>
        </View>
        <Text style={{ color: ADMIN_THEME.ash, fontSize: 13, lineHeight: 18 }}>
          Pick this month's winners, capture mailing addresses, and walk
          each prize from eligible → selected → shipped.
        </Text>
      </VelvetCard>

      <BrassButton
        label="Open the controls"
        onPress={() => router.push("/account/game-room")}
        accent={room.accent}
        icon="arrow-right"
      />
    </RoomShell>
  );
}
