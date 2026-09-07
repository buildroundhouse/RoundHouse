import { useColorScheme } from "react-native";

import colors from "@/constants/colors";

export function useColors() {
  const scheme = useColorScheme();
  const themed = colors as typeof colors & { dark?: typeof colors.light };
  const palette = scheme === "dark" && themed.dark ? themed.dark : themed.light;
  return { ...palette, radius: colors.radius };
}
