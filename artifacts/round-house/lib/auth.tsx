import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { onIdTokenChanged, signOut as fbSignOut, type User } from "firebase/auth";
import { Platform } from "react-native";
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
    let active = true;
    let sync = Promise.resolve();
    const unsub = onIdTokenChanged(auth, (u) => {
      // Serialize account switches so a delayed old response cannot restore
      // the previous account's media cookie after sign-out.
      sync = sync.then(async () => {
        if (Platform.OS === "web") {
          const base = process.env.EXPO_PUBLIC_DOMAIN ? `https://${process.env.EXPO_PUBLIC_DOMAIN}` : "";
          try {
            const token = u ? await u.getIdToken() : null;
            const response = await fetch(`${base}/api/storage/session`, {
              method: token ? "POST" : "DELETE", credentials: "include",
              headers: token ? { Authorization: `Bearer ${token}` } : {},
              signal: AbortSignal.timeout(10000),
            });
            if (!response.ok) console.warn("Could not initialize file access");
          } catch {
            console.warn("Could not initialize file access");
          }
        }
        if (!active) return;
        setUser(u);
        setIsLoaded(true);
      });
    });
    return () => { active = false; unsub(); };
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
