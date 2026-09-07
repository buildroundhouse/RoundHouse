import React, { createContext, useContext, useEffect, useMemo, useRef } from "react";
import {
  useGetMe,
  useListMyModes,
  useListMyOutwardAccounts,
  customFetch,
  type UserProfile,
  type UserModeProfile,
  type UserModeKind,
  type OutwardAccount,
} from "@workspace/api-client-react";
import { useAuth } from "./auth";

export type OnboardingStatus =
  | { kind: "loading" }
  | { kind: "needs-identity" }
  | { kind: "needs-mode-picker" }
  | { kind: "needs-intake"; mode: UserModeProfile }
  // Admin signed in but hasn't (and isn't required to) activate any mode.
  // Used to skip the standard mode-picker / intake gauntlet and route the
  // operator straight to the Admin Hub where they manage demo personas.
  | { kind: "admin-empty" }
  | { kind: "ready"; mode: UserModeProfile };

interface ProfileContextValue {
  profile: UserProfile | null;
  modes: UserModeProfile[];
  activeMode: UserModeProfile | null;
  /** All non-archived outward-facing accounts (public skins). */
  outwardAccounts: OutwardAccount[];
  /** The skin currently scoping reads/writes for the signed-in user. */
  activeOutwardAccount: OutwardAccount | null;
  activeOutwardAccountId: number | null;
  status: OnboardingStatus;
  refetchProfile: () => Promise<void>;
  refetchModes: () => Promise<void>;
  refetchOutwardAccounts: () => Promise<void>;
}

const ProfileContext = createContext<ProfileContextValue | null>(null);

export function ProfileProvider({ children }: { children: React.ReactNode }) {
  const { isSignedIn, isLoaded } = useAuth();

  const enabled = isLoaded && isSignedIn;
  const meQuery = useGetMe({ query: { enabled, queryKey: ["/api/users/me"] } });
  const modesQuery = useListMyModes({ query: { enabled, queryKey: ["/api/users/me/modes"] } });
  const outwardQuery = useListMyOutwardAccounts({
    query: { enabled, queryKey: ["/api/outward-accounts"] },
  });

  const value = useMemo<ProfileContextValue>(() => {
    const profile = (meQuery.data ?? null) as UserProfile | null;
    const modes = (modesQuery.data?.modes ?? []) as UserModeProfile[];
    const activeModeId = modesQuery.data?.activeModeId ?? null;
    const activeMode = activeModeId
      ? modes.find((m) => m.id === activeModeId) ?? modes[0] ?? null
      : modes[0] ?? null;

    // Outward accounts can be sourced from either the dedicated list
    // endpoint or the embedded copy on /users/me. Prefer the dedicated
    // list when it's loaded so optimistic mutations are reflected
    // immediately after invalidation.
    const outwardAccounts: OutwardAccount[] = (outwardQuery.data?.accounts ??
      []) as OutwardAccount[];
    const activeOutwardAccountId =
      outwardQuery.data?.activeOutwardAccountId ?? null;
    const activeOutwardAccount =
      outwardAccounts.find((a) => a.id === activeOutwardAccountId) ??
      outwardAccounts[0] ??
      null;

    let status: OnboardingStatus;
    const profileLoading =
      meQuery.isPending || meQuery.fetchStatus === "fetching" || (!profile && !meQuery.isError);
    const modesLoading =
      modesQuery.isPending ||
      modesQuery.fetchStatus === "fetching" ||
      (!modesQuery.data && !modesQuery.isError);
    if (!isLoaded || !isSignedIn) {
      status = { kind: "loading" };
    } else if (profileLoading || modesLoading || !profile) {
      status = { kind: "loading" };
    } else if (!profile.identityCompletedAt || !profile.avatarUrl) {
      status = { kind: "needs-identity" };
    } else if (profile.isAdmin && modes.length === 0) {
      // Admin operators don't have to wear a real skin to use the app —
      // they manage demo personas and can later "wear" one. Skip the
      // mode-picker / intake entirely and land in the Admin Hub.
      status = { kind: "admin-empty" };
    } else if (modes.length === 0) {
      status = { kind: "needs-mode-picker" };
    } else if (!activeMode) {
      status = { kind: "needs-mode-picker" };
    } else if (!activeMode.intakeCompletedAt) {
      status = { kind: "needs-intake", mode: activeMode };
    } else {
      status = { kind: "ready", mode: activeMode };
    }

    return {
      profile,
      modes,
      activeMode,
      outwardAccounts,
      activeOutwardAccount,
      activeOutwardAccountId,
      status,
      refetchProfile: async () => {
        await meQuery.refetch();
      },
      refetchModes: async () => {
        await modesQuery.refetch();
      },
      refetchOutwardAccounts: async () => {
        await outwardQuery.refetch();
      },
    };
  }, [
    meQuery.data,
    meQuery.isPending,
    meQuery.fetchStatus,
    meQuery.isError,
    modesQuery.data,
    modesQuery.isPending,
    modesQuery.fetchStatus,
    modesQuery.isError,
    outwardQuery.data,
    isLoaded,
    isSignedIn,
    meQuery.refetch,
    modesQuery.refetch,
    outwardQuery.refetch,
  ]);

  // Fire-and-forget: ping the server's daily-login endpoint once per
  // local calendar day per signed-in user. Idempotent server-side, so a
  // double fire is harmless. Wrapped in a ref-guard so we don't spam
  // the endpoint on every profile re-render.
  const lastPingedRef = useRef<string | null>(null);
  useEffect(() => {
    const profile = value.profile;
    if (!profile?.clerkId) return;
    const now = new Date();
    const localDate =
      now.getFullYear() +
      "-" +
      String(now.getMonth() + 1).padStart(2, "0") +
      "-" +
      String(now.getDate()).padStart(2, "0");
    const key = `${profile.clerkId}:${localDate}`;
    if (lastPingedRef.current === key) return;
    lastPingedRef.current = key;
    void customFetch("/api/users/me/events/daily-login", {
      method: "POST",
      body: JSON.stringify({ localDate, localHour: now.getHours() }),
    }).catch(() => { /* non-fatal */ });
  }, [value.profile]);

  return <ProfileContext.Provider value={value}>{children}</ProfileContext.Provider>;
}

export function useProfile(): ProfileContextValue {
  const ctx = useContext(ProfileContext);
  if (!ctx) throw new Error("useProfile must be used inside ProfileProvider");
  return ctx;
}

export function useActiveModeKind(): UserModeKind | null {
  return useProfile().activeMode?.kind ?? null;
}
