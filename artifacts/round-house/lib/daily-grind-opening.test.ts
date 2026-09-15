import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  uid: "person-a",
  stored: new Map<string, string>(),
  cleanup: undefined as undefined | (() => void),
  resume: undefined as undefined | ((s: string) => void),
}));
vi.mock("react", () => ({ useCallback: (fn: unknown) => fn }));
vi.mock("expo-router", () => ({
  useFocusEffect: (fn: () => undefined | (() => void)) => {
    state.cleanup = fn();
  },
}));
vi.mock("react-native", () => ({
  AppState: {
    currentState: "active",
    addEventListener: (_: string, fn: (s: string) => void) => {
      state.resume = fn;
      return { remove: vi.fn() };
    },
  },
}));
vi.mock("./auth", () => ({ useAuth: () => ({ userId: state.uid }) }));
vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: vi.fn(async (key: string) => state.stored.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => {
      state.stored.set(key, value);
    }),
  },
}));
import { useDailyGrindOpening } from "./useDailyGrindOpening";
beforeEach(() => {
  state.cleanup?.();
  state.stored.clear();
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 8, 14, 8));
});
it("opens once, stays closed on resume, opens next local day, and isolates people", async () => {
  const open = vi.fn();
  useDailyGrindOpening(open);
  await vi.advanceTimersByTimeAsync(1);
  expect(open).toHaveBeenCalledTimes(1);
  state.resume?.("active");
  await vi.advanceTimersByTimeAsync(1);
  expect(open).toHaveBeenCalledTimes(1);
  vi.setSystemTime(new Date(2026, 8, 15, 8));
  state.resume?.("active");
  await vi.advanceTimersByTimeAsync(1);
  expect(open).toHaveBeenCalledTimes(2);
  state.cleanup?.();
  state.uid = "person-b";
  useDailyGrindOpening(open);
  await vi.advanceTimersByTimeAsync(1);
  expect(open).toHaveBeenCalledTimes(3);
  state.cleanup?.();
  vi.useRealTimers();
});
it("honors the persisted first-visit marker", async () => {
  state.uid = "person-c";
  state.stored.set("dailyGrind.opened.v1:person-c", "2026-09-14");
  const open = vi.fn();
  useDailyGrindOpening(open);
  await vi.advanceTimersByTimeAsync(1);
  expect(open).not.toHaveBeenCalled();
  state.cleanup?.();
  vi.useRealTimers();
});
