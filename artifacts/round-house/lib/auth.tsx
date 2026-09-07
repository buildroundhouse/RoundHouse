import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { onAuthStateChanged, signOut as fbSignOut, type User } from "firebase/auth";
import { setAuthTokenGetter } from "@workspace/api-client-react";
import { auth, isFirebaseConfigured } from "./firebase";

interface AuthContextValue {
  user: User | null;
  userId: string | null;
  isSignedIn: boolean;
  isLoaded: boolean;
  configured: boolean;
  getToken: () => Promise<string | null>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoaded, setIsLoaded] = useState(!isFirebaseConfigured);

  useEffect(() => {
    setAuthTokenGetter(async () => {
      if (!auth?.currentUser) return null;
      try {
        return await auth.currentUser.getIdToken();
      } catch {
        return null;
      }
    });
  }, []);

  useEffect(() => {
    if (!auth) return;
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setIsLoaded(true);
    });
    return unsub;
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      userId: user?.uid ?? null,
      isSignedIn: !!user,
      isLoaded,
      configured: isFirebaseConfigured,
      getToken: async () => (user ? await user.getIdToken() : null),
      signOut: async () => {
        if (auth) await fbSignOut(auth);
      },
    }),
    [user, isLoaded],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}

export function useUser(): { user: User | null; isSignedIn: boolean; isLoaded: boolean } {
  const { user, isSignedIn, isLoaded } = useAuth();
  return { user, isSignedIn, isLoaded };
}
