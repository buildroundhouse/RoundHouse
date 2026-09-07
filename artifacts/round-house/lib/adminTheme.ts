export const ADMIN_THEME = {
  velvet: "#1A0B12",
  velvetDeep: "#0E0509",
  velvetSheen: "#2A1320",

  oxblood: "#5A0F1F",
  burgundy: "#7E1C32",

  walnut: "#2A1B11",
  walnutLight: "#3E2918",

  emerald: "#0F3A2E",
  emeraldDeep: "#082019",

  brass: "#C9A24A",
  brassBright: "#E8C875",
  brassDim: "#8C6F2E",

  parchment: "#F4ECD7",
  parchmentInk: "#1B130A",

  neonCyan: "#5FE6FF",
  neonMagenta: "#FF6BD6",
  neonLime: "#C9FF5F",

  bone: "#EDE6D6",
  ash: "#9C8E73",
} as const;

export const ROOMS = {
  game: {
    title: "Game Room",
    tagline: "Score controls · Scoreboard · Prizes",
    bg: ADMIN_THEME.velvetDeep,
    bgGrad: [ADMIN_THEME.velvet, ADMIN_THEME.oxblood] as const,
    accent: ADMIN_THEME.brassBright,
    glow: ADMIN_THEME.neonMagenta,
    icon: "zap" as const,
    href: "/account/rooms/game-room",
  },
  label: {
    title: "Label Room",
    tagline: "Chips · Tokens · Titles",
    bg: ADMIN_THEME.walnut,
    bgGrad: [ADMIN_THEME.walnut, ADMIN_THEME.walnutLight] as const,
    accent: ADMIN_THEME.brass,
    glow: ADMIN_THEME.parchment,
    icon: "tag" as const,
    href: "/account/rooms/label-room",
  },
  wardrobe: {
    title: "Avatar Wardrobe",
    tagline: "Wear a skin · Manage demo cast",
    bg: ADMIN_THEME.emeraldDeep,
    bgGrad: [ADMIN_THEME.emerald, ADMIN_THEME.emeraldDeep] as const,
    accent: ADMIN_THEME.brassBright,
    glow: ADMIN_THEME.brass,
    icon: "user" as const,
    href: "/account/wardrobe",
  },
} as const;

export type RoomKey = keyof typeof ROOMS;
