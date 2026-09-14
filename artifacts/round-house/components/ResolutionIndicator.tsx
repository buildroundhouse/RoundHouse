import React, { useEffect, useRef } from "react";
import { AccessibilityInfo, Animated, StyleSheet, View } from "react-native";
import Svg, { Path } from "react-native-svg";

export function ResolutionIndicator({ status, followUps }: { status: "attention" | "waiting" | "resolved"; followUps: number }) {
  const glow = useRef(new Animated.Value(0.65)).current;
  const fire = status !== "resolved" && followUps >= 3;
  useEffect(() => {
    let running: Animated.CompositeAnimation | undefined;
    let active = true;
    const update = (reduced: boolean) => {
      running?.stop(); glow.setValue(0.8);
      if (fire && !reduced && active) {
        running = Animated.loop(Animated.sequence([
          Animated.timing(glow, { toValue: 1, duration: 550, useNativeDriver: true }),
          Animated.timing(glow, { toValue: 0.55, duration: 700, useNativeDriver: true }),
        ])); running.start();
      }
    };
    void AccessibilityInfo.isReduceMotionEnabled().then(update);
    const listener = AccessibilityInfo.addEventListener("reduceMotionChanged", update);
    return () => { active = false; running?.stop(); listener.remove(); };
  }, [fire, glow]);
  const resolved = status === "resolved";
  const color = resolved ? "#8D949C" : status === "attention" ? "#DC2626" : "#16834A";
  const rim = resolved || followUps === 0 ? "#B8BDC4" : followUps === 1 ? "#E6B625" : fire ? "#F97316" : "#DC2626";
  return <View accessible accessibilityLabel={`${resolved ? "Resolved" : status === "attention" ? "Needs your attention" : "Waiting on them"}${!resolved && followUps ? `, ${followUps} unanswered follow-ups` : ""}`} style={s.wrapper}>
    {fire && <Animated.View style={[s.flames, { opacity: glow }]}><Svg width={100} height={50} viewBox="0 0 100 50">
      <Path d="M9 40C0 29 9 21 5 13C17 18 13 5 22 1C20 14 29 12 27 22M74 23C68 11 80 14 78 2C89 8 82 18 96 12C89 25 101 28 91 41" fill="none" stroke="#F97316" strokeWidth={4} strokeLinecap="round" />
    </Svg></Animated.View>}
    <View style={[s.base, { borderColor: rim }]}>
      <View style={s.pivot} />
      <View style={[s.post, { left: status === "attention" ? 39 : 13 }]} />
      <View style={[s.face, { backgroundColor: color, left: status === "attention" ? 56 : 4 }]} />
    </View>
  </View>;
}
const s = StyleSheet.create({
  wrapper: { width: 100, height: 50, justifyContent: "center", alignItems: "center" },
  base: { width: 86, height: 32, borderRadius: 18, borderWidth: 2, backgroundColor: "#D1D5DA", justifyContent: "center" },
  pivot: { position: "absolute", left: 37, width: 8, height: 8, borderRadius: 4, backgroundColor: "#848C95" },
  post: { position: "absolute", width: 30, height: 13, backgroundColor: "#A4ABB3", borderTopWidth: 2, borderTopColor: "#E6E9ED" },
  face: { position: "absolute", width: 24, height: 24, borderRadius: 12 },
  flames: { position: "absolute", top: 0, left: 0 },
});
