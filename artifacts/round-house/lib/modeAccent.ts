import type { UserModeKind } from "@workspace/api-client-react";
import colors from "@/constants/colors";

export type ModeAccent = {
  primary: string;
  primaryForeground: string;
  scoreBackground: string;
  density: "comfortable" | "dense";
  copyTone: "homeowner" | "trade";
  proSearchLabel: string;
  proSearchPlaceholder: string;
  greetingPrefix: string;
};

const HOMEOWNER_BLUE = colors.light.primary;

// Trade Pro gets a warm amber accent so the Timeline tab visually swaps the moment
// the active mode flips. Identity (avatar/name) stays put.
const TRADE_AMBER = "#F2994A";

const HOMEOWNER: ModeAccent = {
  primary: HOMEOWNER_BLUE,
  primaryForeground: "#FFFFFF",
  scoreBackground: colors.light.scoreBackground,
  density: "comfortable",
  copyTone: "homeowner",
  proSearchLabel: "Find a Pro",
  proSearchPlaceholder: "Plumber, electrician, drywall…",
  greetingPrefix: "Hi,",
};

const TRADE_PRO: ModeAccent = {
  primary: TRADE_AMBER,
  primaryForeground: "#1A1A1A",
  scoreBackground: "#FFF1E0",
  density: "dense",
  copyTone: "trade",
  proSearchLabel: "Find a Sub Contractor",
  proSearchPlaceholder: "Sub by trade or company…",
  greetingPrefix: "Hello,",
};

export function getModeAccent(kind: UserModeKind | null | undefined): ModeAccent {
  switch (kind) {
    case "trade_pro":
    case "trade_pro_collab":
      return TRADE_PRO;
    case "home":
    case "facilities":
    case "facilities_collab":
    default:
      return HOMEOWNER;
  }
}
