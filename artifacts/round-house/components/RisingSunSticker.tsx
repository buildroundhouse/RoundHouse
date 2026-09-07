import React from "react";
import { View, Text, StyleSheet } from "react-native";
import Svg, { Circle, G, Line, Text as SvgText } from "react-native-svg";

type Props = {
  size?: number;
  points?: number;
};

/**
 * Compact "rising sun" award sticker. Used to flag the "Share Round House"
 * pill so the inviter sees the points reward at a glance.
 */
export function RisingSunSticker({ size = 56, points = 10 }: Props) {
  const sunColor = "#FFC83D";
  const rayColor = "#FFD972";
  const ink = "#3A2200";

  const cx = size / 2;
  const cy = size / 2;
  const sunR = size * 0.32;
  const innerR = size * 0.4;
  const outerR = size * 0.48;
  const rays = 12;

  return (
    <View style={[styles.wrap, { width: size, height: size }]}> 
      <Svg width={size} height={size}>
        {/* Background coin to read on dark or light banners */}
        <Circle cx={cx} cy={cy} r={size * 0.5 - 1} fill="#0E1116" />
        {/* Rays */}
        <G>
          {Array.from({ length: rays }).map((_, i) => {
            const angle = (i / rays) * Math.PI * 2;
            const x1 = cx + Math.cos(angle) * innerR;
            const y1 = cy + Math.sin(angle) * innerR;
            const x2 = cx + Math.cos(angle) * outerR;
            const y2 = cy + Math.sin(angle) * outerR;
            return (
              <Line
                key={i}
                x1={x1}
                y1={y1}
                x2={x2}
                y2={y2}
                stroke={rayColor}
                strokeWidth={2}
                strokeLinecap="round"
              />
            );
          })}
        </G>
        {/* Sun disc */}
        <Circle cx={cx} cy={cy} r={sunR} fill={sunColor} />
        <SvgText
          x={cx}
          y={cy + size * 0.06}
          fontSize={size * 0.26}
          fontWeight="800"
          fill={ink}
          textAnchor="middle"
        >
          {String(points)}
        </SvgText>
      </Svg>
      <Text
        style={[styles.caption, { fontSize: Math.round(size * 0.16) }]}
        numberOfLines={1}
      >
        POINTS
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
  },
  caption: {
    position: "absolute",
    bottom: 2,
    color: "#FFC83D",
    fontFamily: "Inter_700Bold",
    letterSpacing: 0.5,
    backgroundColor: "rgba(14,17,22,0.9)",
    paddingHorizontal: 4,
    borderRadius: 4,
    overflow: "hidden",
  },
});
