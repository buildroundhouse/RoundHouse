import React, { useId } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import Svg, { Defs, Filter, FeColorMatrix, Image } from "react-native-svg";
import source from "@/assets/rewards/wood/original";

/** The artwork itself opens Rewards; the space below is reserved for its ticker. */
export function WoodRewardsButton({ onPress, points }: { onPress: () => void; points: number }) {
  const id = `wood${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  return <View style={styles.slot}>
    <Pressable onPress={onPress} accessibilityRole="button"
      accessibilityLabel={`Open Reward Center, Wood badge, ${points} points`}
      style={styles.button}>
      <Svg width={80} height={34} viewBox="40 20 1460 620" pointerEvents="none">
        <Defs><Filter id={id} x="0%" y="0%" width="100%" height="100%">
          <FeColorMatrix type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  -3 -3 -3 0 8" />
        </Filter></Defs>
        <Image href={source} x={0} y={0} width={1536} height={741} filter={`url(#${id})`} />
      </Svg>
    </Pressable>
  </View>;
}

const styles = StyleSheet.create({
  slot: { width: 80, height: 56, flexShrink: 0, alignSelf: "flex-start" },
  button: { width: 80, height: 44, alignItems: "center", justifyContent: "flex-start" },
});
