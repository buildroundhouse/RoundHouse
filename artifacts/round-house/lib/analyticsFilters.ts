import { useCallback, useEffect, useRef, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

const STORAGE_KEY = "round-house:analytics-filters:v1";

export type StoredCustomRange = { from: string; to: string } | null;

export type AnalyticsPreset = "thisMonth" | "lastMonth" | "lastQuarter" | "ytd";

export const ANALYTICS_PRESETS: { key: AnalyticsPreset; label: string }[] = [
  { key: "thisMonth", label: "This month" },
  { key: "lastMonth", label: "Last month" },
  { key: "lastQuarter", label: "Last quarter" },
  { key: "ytd", label: "YTD" },
];

export type AnalyticsFiltersState = {
  rangeDays: number;
  propertyId: number | null;
  customRange: StoredCustomRange;
  preset: AnalyticsPreset | null;
};

export const DEFAULT_ANALYTICS_FILTERS: AnalyticsFiltersState = {
  rangeDays: 180,
  propertyId: null,
  customRange: null,
  preset: null,
};

const PRESET_KEYS: AnalyticsPreset[] = ANALYTICS_PRESETS.map((p) => p.key);

export function computePresetRange(
  preset: AnalyticsPreset,
  now: Date = new Date(),
): { from: Date; to: Date } {
  const year = now.getFullYear();
  const month = now.getMonth();
  switch (preset) {
    case "thisMonth": {
      const from = new Date(year, month, 1, 0, 0, 0, 0);
      const to = new Date(year, month + 1, 1, 0, 0, 0, 0);
      return { from, to };
    }
    case "lastMonth": {
      const from = new Date(year, month - 1, 1, 0, 0, 0, 0);
      const to = new Date(year, month, 1, 0, 0, 0, 0);
      return { from, to };
    }
    case "lastQuarter": {
      const currentQuarter = Math.floor(month / 3);
      const lastQuarterStartMonth = (currentQuarter - 1) * 3;
      const from = new Date(year, lastQuarterStartMonth, 1, 0, 0, 0, 0);
      const to = new Date(year, lastQuarterStartMonth + 3, 1, 0, 0, 0, 0);
      return { from, to };
    }
    case "ytd": {
      const from = new Date(year, 0, 1, 0, 0, 0, 0);
      const to = new Date(now.getTime());
      return { from, to };
    }
  }
}

function sanitize(parsed: unknown): AnalyticsFiltersState {
  if (!parsed || typeof parsed !== "object") return DEFAULT_ANALYTICS_FILTERS;
  const p = parsed as Partial<AnalyticsFiltersState>;
  const rangeDays =
    typeof p.rangeDays === "number" && Number.isFinite(p.rangeDays) && p.rangeDays > 0
      ? p.rangeDays
      : DEFAULT_ANALYTICS_FILTERS.rangeDays;
  const propertyId =
    typeof p.propertyId === "number" && Number.isFinite(p.propertyId) ? p.propertyId : null;
  let customRange: StoredCustomRange = null;
  if (
    p.customRange &&
    typeof p.customRange === "object" &&
    typeof (p.customRange as { from?: unknown }).from === "string" &&
    typeof (p.customRange as { to?: unknown }).to === "string"
  ) {
    const from = (p.customRange as { from: string }).from;
    const to = (p.customRange as { to: string }).to;
    if (!Number.isNaN(Date.parse(from)) && !Number.isNaN(Date.parse(to))) {
      customRange = { from, to };
    }
  }
  const preset =
    typeof p.preset === "string" && (PRESET_KEYS as string[]).includes(p.preset)
      ? (p.preset as AnalyticsPreset)
      : null;
  return { rangeDays, propertyId, customRange, preset };
}

export function useAnalyticsFilters() {
  const [state, setState] = useState<AnalyticsFiltersState>(DEFAULT_ANALYTICS_FILTERS);
  const [hydrated, setHydrated] = useState(false);
  const hydratedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(STORAGE_KEY)
      .then((raw) => {
        if (cancelled) return;
        if (raw) {
          try {
            setState(sanitize(JSON.parse(raw)));
          } catch {
            // ignore corrupt value
          }
        }
        hydratedRef.current = true;
        setHydrated(true);
      })
      .catch(() => {
        hydratedRef.current = true;
        setHydrated(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!hydratedRef.current) return;
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(state)).catch(() => {
      // ignore write failures
    });
  }, [state]);

  const update = useCallback((patch: Partial<AnalyticsFiltersState>) => {
    setState((prev) => ({ ...prev, ...patch }));
  }, []);

  return { state, update, hydrated };
}
