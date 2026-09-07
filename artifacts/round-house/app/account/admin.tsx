import React, { useEffect } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Stack, useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { ADMIN_THEME, ROOMS, type RoomKey } from "@/lib/adminTheme";
import { useProfile } from "@/lib/profile";

const DOOR_ORDER: RoomKey[] = ["game", "label", "wardrobe"];

export default function AdminLobbyScreen() {
  const router = useRouter();
  const { profile } = useProfile();
  const isAdmin = (profile as { isAdmin?: boolean } | null)?.isAdmin === true;
  // Tap on the ADMIN marquee jumps the admin straight to their
  // public profile tab — the previous attempt opened the public
  // profile modal here, but it depended on profile.clerkId being
  // hydrated which left the button looking inactive on first paint
  // (and the user reported it as broken). A plain route push is
  // synchronous, never disabled, and lands on the same page.
  const goToPublicProfile = () => {
    router.push("/(tabs)/profile" as never);
  };

  useEffect(() => {
    if (profile && !isAdmin) router.back();
  }, [profile, isAdmin, router]);

  return (
    <LinearGradient
      colors={[ADMIN_THEME.velvet, ADMIN_THEME.velvetDeep, ADMIN_THEME.oxblood]}
      style={{ flex: 1 }}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
    >
      <Stack.Screen options={{ headerShown: false }} />
      <ScrollView
        contentContainerStyle={{
          padding: 20,
          paddingTop: 56,
          paddingBottom: 80,
          gap: 28,
        }}
      >
        {/* Brass marquee */}
        <View style={s.marqueeOuter}>
          <View style={s.bulbRow}>
            {Array.from({ length: 16 }).map((_, i) => (
              <View
                key={i}
                style={[
                  s.bulb,
                  {
                    backgroundColor:
                      i % 3 === 0
                        ? ADMIN_THEME.brassBright
                        : ADMIN_THEME.brass,
                    shadowColor: ADMIN_THEME.brassBright,
                  },
                ]}
              />
            ))}
          </View>
          {/*
            Tap on the ADMIN block exits the hub straight to the
            admin's normal Profile tab. Synchronous router push —
            never disabled, never depends on async profile data, so
            it can never get stuck looking inactive. Chevron-left and
            underline on the ADMIN word are the visual cue that this
            is a back link out of the hub.
          */}
          <Pressable
            onPress={goToPublicProfile}
            accessibilityRole="link"
            accessibilityLabel={
              profile?.username
                ? `Exit the Admin Hub to your profile tab (@${profile.username})`
                : "Exit the Admin Hub to your profile tab"
            }
            style={({ pressed }) => [
              s.marqueeInner,
              { opacity: pressed ? 0.7 : 1 },
            ]}
          >
            <Text style={s.marqueeKicker}>Behind the curtain</Text>
            <View style={s.marqueeTitleRow}>
              <Feather
                name="chevron-left"
                size={32}
                color={ADMIN_THEME.brassBright}
              />
              <Text style={[s.marqueeTitle, s.marqueeTitleLink]}>ADMIN</Text>
            </View>
          </Pressable>
          <View style={s.bulbRow}>
            {Array.from({ length: 16 }).map((_, i) => (
              <View
                key={`b${i}`}
                style={[
                  s.bulb,
                  {
                    backgroundColor:
                      i % 3 === 0
                        ? ADMIN_THEME.brass
                        : ADMIN_THEME.brassBright,
                    shadowColor: ADMIN_THEME.brassBright,
                  },
                ]}
              />
            ))}
          </View>
        </View>

        {/* Velvet curtain divider */}
        <View style={s.curtain}>
          {Array.from({ length: 9 }).map((_, i) => (
            <LinearGradient
              key={i}
              colors={[ADMIN_THEME.velvetSheen, ADMIN_THEME.velvetDeep]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={s.curtainPanel}
            />
          ))}
        </View>

        <Text style={s.lobbyHelp}>
          Three doors. Pick one.
        </Text>

        {/* Doors */}
        <View style={{ gap: 18 }}>
          {DOOR_ORDER.map((key) => {
            const room = ROOMS[key];
            return (
              <Pressable
                key={key}
                onPress={() => router.push(room.href as never)}
                style={({ pressed }) => [
                  s.door,
                  {
                    borderColor: room.accent,
                    transform: [{ translateY: pressed ? 2 : 0 }],
                    shadowColor: room.glow ?? room.accent,
                  },
                ]}
              >
                <LinearGradient
                  colors={room.bgGrad}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={s.doorGrad}
                >
                  <View style={s.doorTopBulbs}>
                    {Array.from({ length: 9 }).map((_, i) => (
                      <View
                        key={i}
                        style={[
                          s.doorBulb,
                          {
                            backgroundColor: room.accent,
                            shadowColor: room.glow ?? room.accent,
                          },
                        ]}
                      />
                    ))}
                  </View>

                  <View style={s.doorBody}>
                    <View
                      style={[s.doorIcon, { borderColor: room.accent }]}
                    >
                      <Feather
                        name={room.icon}
                        size={28}
                        color={room.accent}
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[s.doorTitle, { color: ADMIN_THEME.bone }]}>
                        {room.title}
                      </Text>
                      <Text
                        style={[s.doorTag, { color: ADMIN_THEME.ash }]}
                        numberOfLines={1}
                      >
                        {room.tagline}
                      </Text>
                    </View>
                    <View
                      style={[s.brassKnob, { borderColor: room.accent }]}
                    >
                      <Feather
                        name="chevron-right"
                        size={18}
                        color={room.accent}
                      />
                    </View>
                  </View>

                  {/* Brass nameplate */}
                  <View
                    style={[s.nameplate, { borderColor: room.accent }]}
                  >
                    <Text
                      style={[
                        s.nameplateText,
                        { color: room.accent },
                      ]}
                    >
                      ROOM № {DOOR_ORDER.indexOf(key) + 1}
                    </Text>
                  </View>
                </LinearGradient>
              </Pressable>
            );
          })}
        </View>

        <View style={{ alignItems: "center", paddingTop: 12 }}>
          <Text
            style={{
              color: ADMIN_THEME.ash,
              fontSize: 10,
              letterSpacing: 4,
              textTransform: "uppercase",
            }}
          >
            ✦ Members only ✦
          </Text>
        </View>
      </ScrollView>
      {/*
        The PublicProfileModal mount that used to live here was
        removed when the ADMIN marquee was switched to a direct
        router.push("/(tabs)/profile") — there is nothing to open
        in-place anymore.
      */}
    </LinearGradient>
  );
}

const s = StyleSheet.create({
  marqueeOuter: {
    borderWidth: 2,
    borderColor: ADMIN_THEME.brass,
    borderRadius: 16,
    overflow: "hidden",
  },
  bulbRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: ADMIN_THEME.velvetDeep,
  },
  bulb: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    shadowOpacity: 0.95,
    shadowRadius: 5,
    shadowOffset: { width: 0, height: 0 },
  },
  marqueeInner: {
    backgroundColor: ADMIN_THEME.velvet,
    paddingVertical: 22,
    paddingHorizontal: 18,
    alignItems: "center",
    gap: 4,
  },
  marqueeKicker: {
    color: ADMIN_THEME.brassBright,
    fontSize: 10,
    letterSpacing: 5,
    textTransform: "uppercase",
    fontWeight: "800",
  },
  marqueeTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  marqueeTitle: {
    color: ADMIN_THEME.bone,
    fontSize: 44,
    fontWeight: "900",
    letterSpacing: 8,
  },
  marqueeTitleLink: {
    textDecorationLine: "underline",
    textDecorationColor: ADMIN_THEME.brassBright,
  },
  marqueeSub: {
    color: ADMIN_THEME.ash,
    fontSize: 11,
    letterSpacing: 3,
    textTransform: "uppercase",
  },
  curtain: {
    flexDirection: "row",
    height: 14,
    gap: 1,
  },
  curtainPanel: {
    flex: 1,
    height: "100%",
    borderRadius: 2,
  },
  lobbyHelp: {
    color: ADMIN_THEME.ash,
    fontSize: 12,
    letterSpacing: 3,
    textTransform: "uppercase",
    textAlign: "center",
    fontWeight: "700",
  },
  door: {
    borderWidth: 2,
    borderRadius: 18,
    overflow: "hidden",
    shadowOpacity: 0.35,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
  },
  doorGrad: {
    paddingBottom: 14,
  },
  doorTopBulbs: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 18,
    paddingTop: 10,
    paddingBottom: 6,
  },
  doorBulb: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    shadowOpacity: 0.95,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 0 },
  },
  doorBody: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingHorizontal: 18,
    paddingVertical: 18,
  },
  doorIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.35)",
  },
  doorTitle: {
    fontSize: 20,
    fontWeight: "900",
    letterSpacing: 1.5,
  },
  doorTag: {
    fontSize: 11,
    letterSpacing: 2,
    textTransform: "uppercase",
    marginTop: 2,
  },
  brassKnob: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.3)",
  },
  nameplate: {
    alignSelf: "center",
    borderWidth: 1,
    borderRadius: 4,
    paddingHorizontal: 10,
    paddingVertical: 3,
    marginTop: 4,
  },
  nameplateText: {
    fontSize: 9,
    letterSpacing: 3,
    fontWeight: "800",
  },
});
