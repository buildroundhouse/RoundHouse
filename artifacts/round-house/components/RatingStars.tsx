import React from "react";
import { StyleSheet, TouchableOpacity, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";

interface Props {
  value: number;
  size?: number;
  onChange?: (n: number) => void;
}

export function RatingStars({ value, size = 14, onChange }: Props) {
  const colors = useColors();
  const stars = [1, 2, 3, 4, 5];
  return (
    <View style={styles.row}>
      {stars.map((n) => {
        const filled = n <= Math.round(value);
        const node = (
          <Feather
            name={filled ? "star" : "star"}
            size={size}
            color={filled ? "#E8A547" : colors.border}
            style={{ opacity: filled ? 1 : 0.6 }}
          />
        );
        if (onChange) {
          return (
            <TouchableOpacity key={n} onPress={() => onChange(n)} hitSlop={8}>
              {node}
            </TouchableOpacity>
          );
        }
        return <View key={n}>{node}</View>;
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", gap: 2, alignItems: "center" },
});
