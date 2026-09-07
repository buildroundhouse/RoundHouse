import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { OutwardAccount } from "@workspace/api-client-react";
import { useProfile } from "./profile";

interface ActiveOutwardAccountContextValue {
  accounts: OutwardAccount[];
  activeOutwardAccountId: number | null;
  activeAccount: OutwardAccount | null;
  setLocalActiveAccountId: (id: number | null) => void;
  refetch: () => Promise<void>;
  /**
   * A ref that always reflects the current active outward account id.
   * Bridged into the API client so every authenticated request carries
   * an `x-active-outward-account-id` header without forcing every call
   * site to re-render when the id changes.
   */
  idRef: React.MutableRefObject<number | null>;
}

const ActiveOutwardAccountContext =
  createContext<ActiveOutwardAccountContextValue | null>(null);

export function ActiveOutwardAccountProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const {
    outwardAccounts,
    activeOutwardAccountId: serverActiveId,
    refetchOutwardAccounts,
  } = useProfile();

  // Local override lets a "switch" mutation reflect immediately in the
  // header on the very next request, before the server's /users/me round
  // trip has confirmed it.
  const [localId, setLocalId] = useState<number | null>(null);

  // Drop the local override once the server confirms the same id, so we
  // do not keep an obsolete value alive across logouts.
  useEffect(() => {
    if (localId != null && serverActiveId === localId) {
      setLocalId(null);
    }
  }, [localId, serverActiveId]);

  const effectiveId = localId ?? serverActiveId ?? null;

  const idRef = useRef<number | null>(effectiveId);
  useEffect(() => {
    idRef.current = effectiveId;
  }, [effectiveId]);

  const activeAccount = useMemo(
    () =>
      outwardAccounts.find((a) => a.id === effectiveId) ??
      outwardAccounts[0] ??
      null,
    [outwardAccounts, effectiveId],
  );

  const refetch = useCallback(async () => {
    await refetchOutwardAccounts();
  }, [refetchOutwardAccounts]);

  const value = useMemo<ActiveOutwardAccountContextValue>(
    () => ({
      accounts: outwardAccounts,
      activeOutwardAccountId: effectiveId,
      activeAccount,
      setLocalActiveAccountId: setLocalId,
      refetch,
      idRef,
    }),
    [outwardAccounts, effectiveId, activeAccount, refetch],
  );

  return (
    <ActiveOutwardAccountContext.Provider value={value}>
      {children}
    </ActiveOutwardAccountContext.Provider>
  );
}

export function useActiveOutwardAccount(): ActiveOutwardAccountContextValue {
  const ctx = useContext(ActiveOutwardAccountContext);
  if (!ctx) {
    throw new Error(
      "useActiveOutwardAccount must be used inside ActiveOutwardAccountProvider",
    );
  }
  return ctx;
}

export function useActiveOutwardAccountIdRef(): React.MutableRefObject<
  number | null
> {
  return useActiveOutwardAccount().idRef;
}
