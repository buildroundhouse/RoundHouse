/**
 * Preset chip/token sets — admin-editable lists rendered as chips
 * across the app (home priorities, maintenance focus, trades, service
 * categories, work-order categories, work-order priorities).
 *
 * The provider fetches the live values from the API once on mount and
 * polls every 30s so admin renames propagate within seconds. If the
 * fetch fails or hasn't returned yet, consumers fall back to bundled
 * defaults that mirror what the server seeds on first boot — keeping
 * the app functional offline and during cold starts.
 */
import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { customFetch } from "@workspace/api-client-react";

export type PresetSetKey =
  | "home_priorities"
  | "maintenance_focus"
  | "trades"
  | "service_categories"
  | "work_order_categories"
  | "work_order_priorities";

export interface PresetChipDTO {
  id: number;
  chipId: string;
  label: string;
  sublabel: string | null;
  groupKey: string | null;
  sortOrder: number;
  /**
   * ISO timestamp if the chip is archived; null if active.
   * Archived chips remain in the set so historical assignments resolve
   * to a current label, but pickers should filter them out.
   */
  archivedAt?: string | null;
}
export interface PresetGroupDTO {
  groupKey: string;
  label: string;
  sortOrder: number;
}
export interface PresetSetDTO {
  setKey: PresetSetKey;
  chips: PresetChipDTO[];
  groups: PresetGroupDTO[];
}
interface PresetSetsResponse {
  sets: Record<string, PresetSetDTO>;
  updatedAt: string;
}

// --- Bundled defaults (cold-start fallback) --------------------------
// Mirrors lib/db seed values. Server is source of truth; these only
// matter before the first successful fetch.

function chip(chipId: string, label: string, groupKey?: string): PresetChipDTO {
  return { id: -1, chipId, label, sublabel: null, groupKey: groupKey ?? null, sortOrder: 0 };
}

const DEFAULT_HOME_PRIORITIES = [
  chip("warmth", "Warmth"),
  chip("longevity", "Longevity"),
  chip("design", "Design"),
  chip("safety", "Safety"),
  chip("calm", "Calm"),
  chip("garden", "Garden"),
  chip("memory", "Memory"),
];
const DEFAULT_MAINTENANCE_FOCUS = [
  chip("preventive", "Preventive"),
  chip("compliance", "Compliance"),
  chip("uptime", "Uptime"),
  chip("cost", "Cost"),
  chip("tenant", "Tenant satisfaction"),
  chip("energy", "Energy"),
];
const DEFAULT_TRADES = [
  chip("general", "General Contractor"),
  chip("electrician", "Electrician"),
  chip("plumber", "Plumber"),
  chip("hvac", "HVAC"),
  chip("carpenter", "Carpenter"),
  chip("painter", "Painter"),
  chip("landscaper", "Landscaper"),
  chip("cleaner", "Cleaner"),
  chip("handyman", "Handyman"),
  chip("other", "Other"),
];
const DEFAULT_WO_CATEGORIES = [
  chip("preventive", "Preventive"),
  chip("corrective", "Corrective"),
  chip("emergency", "Emergency"),
  chip("inspection", "Inspection"),
];
const DEFAULT_WO_PRIORITIES = [
  chip("low", "Low"),
  chip("normal", "Normal"),
  chip("high", "High"),
  chip("urgent", "Urgent"),
];

function asSet(setKey: PresetSetKey, chips: PresetChipDTO[], groups: PresetGroupDTO[] = []): PresetSetDTO {
  return {
    setKey,
    chips: chips.map((c, i) => ({ ...c, sortOrder: i })),
    groups,
  };
}

const DEFAULT_SETS: Record<PresetSetKey, PresetSetDTO> = {
  home_priorities: asSet("home_priorities", DEFAULT_HOME_PRIORITIES),
  maintenance_focus: asSet("maintenance_focus", DEFAULT_MAINTENANCE_FOCUS),
  trades: asSet("trades", DEFAULT_TRADES),
  // Service categories default is built lazily from serviceCategories.ts
  // to keep this module dependency-free; see useServiceCategories below.
  service_categories: asSet("service_categories", []),
  work_order_categories: asSet("work_order_categories", DEFAULT_WO_CATEGORIES),
  work_order_priorities: asSet("work_order_priorities", DEFAULT_WO_PRIORITIES),
};

interface Ctx {
  sets: Record<PresetSetKey, PresetSetDTO>;
  loaded: boolean;
  refresh: () => Promise<void>;
}

const PresetChipsContext = createContext<Ctx>({
  sets: DEFAULT_SETS,
  loaded: false,
  refresh: async () => {},
});

const REFRESH_MS = 30_000;

export function PresetChipsProvider({ children }: { children: ReactNode }) {
  const [sets, setSets] = useState<Record<PresetSetKey, PresetSetDTO>>(DEFAULT_SETS);
  const [loaded, setLoaded] = useState(false);
  const cancelled = useRef(false);

  const refresh = React.useCallback(async () => {
    try {
      const data = await customFetch<PresetSetsResponse>("/api/preset-chips");
      if (cancelled.current || !data?.sets) return;
      // Merge: keep DEFAULT_SETS shape, overlay with whatever the
      // server returns for known keys.
      const next = { ...DEFAULT_SETS };
      for (const key of Object.keys(data.sets) as PresetSetKey[]) {
        const incoming = data.sets[key];
        if (!incoming) continue;
        next[key] = {
          setKey: key,
          chips: [...incoming.chips].sort((a, b) => a.sortOrder - b.sortOrder),
          groups: [...incoming.groups].sort((a, b) => a.sortOrder - b.sortOrder),
        };
      }
      setSets(next);
      setLoaded(true);
    } catch {
      // Swallow — defaults remain in place. Next interval retries.
    }
  }, []);

  useEffect(() => {
    cancelled.current = false;
    void refresh();
    const handle = setInterval(() => {
      void refresh();
    }, REFRESH_MS);
    return () => {
      cancelled.current = true;
      clearInterval(handle);
    };
  }, [refresh]);

  const value = useMemo(() => ({ sets, loaded, refresh }), [sets, loaded, refresh]);
  return (
    <PresetChipsContext.Provider value={value}>
      {children}
    </PresetChipsContext.Provider>
  );
}

/**
 * Returns the raw set including archived chips. Use for label
 * resolution; use `usePresetChips` for pickers.
 */
export function usePresetSet(setKey: PresetSetKey): PresetSetDTO {
  const ctx = useContext(PresetChipsContext);
  return ctx.sets[setKey] ?? DEFAULT_SETS[setKey];
}

/**
 * Active chips for the given set, with archived ones filtered out.
 * Use this for any picker / new-selection UI.
 */
export function usePresetChips(setKey: PresetSetKey): PresetChipDTO[] {
  const set = usePresetSet(setKey);
  return useMemo(() => set.chips.filter((c) => !c.archivedAt), [set]);
}

/** All chips including archived — for label resolution and admin UI. */
export function usePresetChipsAll(setKey: PresetSetKey): PresetChipDTO[] {
  return usePresetSet(setKey).chips;
}

export interface ChipLabelInfo {
  label: string;
  archived: boolean;
}

/**
 * Resolve a chip id back to its current label and archive state.
 * Falls back to a humanized version of the id so historical values
 * still render even if the chip has been deleted.
 */
export function chipLabelInfo(
  chips: PresetChipDTO[],
  chipId: string | null | undefined,
): ChipLabelInfo {
  if (!chipId) return { label: "", archived: false };
  const found = chips.find((c) => c.chipId === chipId);
  if (found) return { label: found.label, archived: !!found.archivedAt };
  // Humanize: "tenant_satisfaction" -> "Tenant satisfaction"
  const text = chipId.replace(/_/g, " ").trim();
  const label = text.length === 0 ? chipId : text.charAt(0).toUpperCase() + text.slice(1);
  return { label, archived: false };
}

/**
 * Resolve a chip id to its current display label. If the chip is
 * archived, append a subtle " (retired)" suffix so callers rendering
 * historical assignments make the state visible.
 */
export function chipLabel(
  chips: PresetChipDTO[],
  chipId: string | null | undefined,
): string {
  const info = chipLabelInfo(chips, chipId);
  return info.archived ? `${info.label} (retired)` : info.label;
}

export function useChipLabel(setKey: PresetSetKey, chipId: string | null | undefined): string {
  const chips = usePresetChipsAll(setKey);
  return useMemo(() => chipLabel(chips, chipId), [chips, chipId]);
}

export function useChipLabelInfo(
  setKey: PresetSetKey,
  chipId: string | null | undefined,
): ChipLabelInfo {
  const chips = usePresetChipsAll(setKey);
  return useMemo(() => chipLabelInfo(chips, chipId), [chips, chipId]);
}

// --- Intake field resolution -----------------------------------------
// Maps intake-form field keys to the preset set whose chips should
// drive their options. Add new entries here when a new chip-driven
// field is introduced in lib/intake-schemas.ts.
const INTAKE_FIELD_TO_SET: Record<string, PresetSetKey> = {
  matters: "home_priorities",
  maintenanceGoals: "maintenance_focus",
  trade: "trades",
};

interface IntakeFieldLike {
  key: string;
  options?: { value: string; label: string; sublabel?: string }[];
  [k: string]: unknown;
}
interface IntakeLike {
  fields: IntakeFieldLike[];
  [k: string]: unknown;
}

/**
 * Replace the `options` array on any intake field whose key is mapped
 * to a preset set with the live chips. Fields that don't map are left
 * untouched, preserving the original schema.
 */
/**
 * Service categories grouped by their preset group, ready for the
 * picker UI. Returns `null` until either the server responds or the
 * caller's bundled fallback has been hydrated, so callers can fall
 * back to their own static lists.
 */
export interface ServiceGroupView {
  label: string;
  items: { chipId: string; label: string }[];
}
export function useServiceCategoryView(): {
  groups: ServiceGroupView[];
  all: { chipId: string; label: string }[];
} | null {
  const set = usePresetSet("service_categories");
  return useMemo(() => {
    const active = set.chips.filter((c) => !c.archivedAt);
    if (active.length === 0) return null;
    const byGroup = new Map<string, ServiceGroupView>();
    for (const g of set.groups) {
      byGroup.set(g.groupKey, { label: g.label, items: [] });
    }
    const ungrouped: ServiceGroupView = { label: "Other", items: [] };
    for (const c of active) {
      const target = c.groupKey ? byGroup.get(c.groupKey) : null;
      (target ?? ungrouped).items.push({ chipId: c.chipId, label: c.label });
    }
    const groups = [...byGroup.values()].filter((g) => g.items.length > 0);
    if (ungrouped.items.length > 0) groups.push(ungrouped);
    return {
      groups,
      all: active.map((c) => ({ chipId: c.chipId, label: c.label })),
    };
  }, [set]);
}

export function useResolvedIntake<T extends IntakeLike>(intake: T): T {
  const ctx = useContext(PresetChipsContext);
  return useMemo(() => {
    const fields = intake.fields.map((f) => {
      const setKey = INTAKE_FIELD_TO_SET[f.key];
      if (!setKey) return f;
      const set = ctx.sets[setKey] ?? DEFAULT_SETS[setKey];
      const active = set ? set.chips.filter((c) => !c.archivedAt) : [];
      if (active.length === 0) return f;
      return {
        ...f,
        options: active.map((c) => ({
          value: c.chipId,
          label: c.label,
          sublabel: c.sublabel ?? undefined,
        })),
      };
    });
    return { ...intake, fields } as T;
  }, [intake, ctx.sets]);
}
