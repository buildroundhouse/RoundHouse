import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

export interface Property {
  id: string;
  name: string;
  address: string;
  type: "home" | "commercial" | "rental";
  createdAt: string;
  isPro: boolean;
  /**
   * True iff this property was spawned by a demo avatar from the admin
   * Wardrobe. Behavior and permissions are unchanged — the only effect
   * is a visible "DEMO" badge wherever this property appears so the
   * viewer can tell it's not real production data.
   */
  isAdminDemo?: boolean;
  coverColor: string;
  placeId?: string | null;
  latitude?: number | null;
  longitude?: number | null;
}

export interface WorkLog {
  id: string;
  propertyId: string;
  note: string;
  photoUri?: string;
  timestamp: string;
  isRealTime: boolean;
  viewed: boolean;
  score: number;
}

export interface UserStats {
  totalLogs: number;
  streak: number;
  lastLogDate: string | null;
  score: number;
}

interface AppContextType {
  properties: Property[];
  logs: WorkLog[];
  stats: UserStats;
  addProperty: (p: Omit<Property, "id" | "createdAt" | "coverColor">) => void;
  updateProperty: (id: string, updates: Partial<Property>) => void;
  deleteProperty: (id: string) => void;
  addLog: (log: Omit<WorkLog, "id" | "timestamp" | "viewed" | "score" | "isRealTime">) => void;
  markLogViewed: (logId: string) => void;
  getPropertyLogs: (propertyId: string) => WorkLog[];
  getPropertyScore: (propertyId: string) => number;
  isLoading: boolean;
}

const COVER_COLORS = [
  "#4A7C59",
  "#3A6B8A",
  "#8A6A3A",
  "#7A4A8A",
  "#3A7A72",
  "#8A3A4A",
  "#4A4A8A",
];

const AppContext = createContext<AppContextType | null>(null);

const STORAGE_KEYS = {
  properties: "rh_properties",
  logs: "rh_logs",
  stats: "rh_stats",
};

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [properties, setProperties] = useState<Property[]>([]);
  const [logs, setLogs] = useState<WorkLog[]>([]);
  const [stats, setStats] = useState<UserStats>({
    totalLogs: 0,
    streak: 0,
    lastLogDate: null,
    score: 0,
  });
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const [pRaw, lRaw, sRaw] = await Promise.all([
          AsyncStorage.getItem(STORAGE_KEYS.properties),
          AsyncStorage.getItem(STORAGE_KEYS.logs),
          AsyncStorage.getItem(STORAGE_KEYS.stats),
        ]);
        if (pRaw) setProperties(JSON.parse(pRaw));
        if (lRaw) setLogs(JSON.parse(lRaw));
        if (sRaw) setStats(JSON.parse(sRaw));
      } catch (e) {
      } finally {
        setIsLoading(false);
      }
    })();
  }, []);

  const persistProperties = useCallback(async (data: Property[]) => {
    await AsyncStorage.setItem(STORAGE_KEYS.properties, JSON.stringify(data));
  }, []);

  const persistLogs = useCallback(async (data: WorkLog[]) => {
    await AsyncStorage.setItem(STORAGE_KEYS.logs, JSON.stringify(data));
  }, []);

  const persistStats = useCallback(async (data: UserStats) => {
    await AsyncStorage.setItem(STORAGE_KEYS.stats, JSON.stringify(data));
  }, []);

  const addProperty = useCallback(
    (p: Omit<Property, "id" | "createdAt" | "coverColor">) => {
      const newProp: Property = {
        ...p,
        id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
        createdAt: new Date().toISOString(),
        coverColor: COVER_COLORS[Math.floor(Math.random() * COVER_COLORS.length)],
      };
      setProperties((prev) => {
        const next = [newProp, ...prev];
        persistProperties(next);
        return next;
      });
    },
    [persistProperties]
  );

  const updateProperty = useCallback(
    (id: string, updates: Partial<Property>) => {
      setProperties((prev) => {
        const next = prev.map((p) => (p.id === id ? { ...p, ...updates } : p));
        persistProperties(next);
        return next;
      });
    },
    [persistProperties]
  );

  const deleteProperty = useCallback(
    (id: string) => {
      setProperties((prev) => {
        const next = prev.filter((p) => p.id !== id);
        persistProperties(next);
        return next;
      });
      setLogs((prev) => {
        const next = prev.filter((l) => l.propertyId !== id);
        persistLogs(next);
        return next;
      });
    },
    [persistProperties, persistLogs]
  );

  const computeScore = (isRealTime: boolean, streak: number): number => {
    let base = 10;
    if (isRealTime) base += 5;
    if (streak > 3) base += 3;
    if (streak > 7) base += 5;
    return base;
  };

  const addLog = useCallback(
    (log: Omit<WorkLog, "id" | "timestamp" | "viewed" | "score" | "isRealTime">) => {
      const now = new Date();
      const isRealTime = true;
      setStats((prevStats) => {
        const today = now.toISOString().split("T")[0];
        const lastDate = prevStats.lastLogDate;
        let newStreak = prevStats.streak;
        if (lastDate) {
          const yesterday = new Date(now);
          yesterday.setDate(yesterday.getDate() - 1);
          const yesterdayStr = yesterday.toISOString().split("T")[0];
          if (lastDate === today) {
          } else if (lastDate === yesterdayStr) {
            newStreak += 1;
          } else {
            newStreak = 1;
          }
        } else {
          newStreak = 1;
        }
        const logScore = computeScore(isRealTime, newStreak);
        const newLog: WorkLog = {
          ...log,
          id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
          timestamp: now.toISOString(),
          isRealTime,
          viewed: false,
          score: logScore,
        };
        setLogs((prev) => {
          const next = [newLog, ...prev];
          persistLogs(next);
          return next;
        });
        const updatedStats: UserStats = {
          totalLogs: prevStats.totalLogs + 1,
          streak: newStreak,
          lastLogDate: today,
          score: prevStats.score + logScore,
        };
        persistStats(updatedStats);
        return updatedStats;
      });
    },
    [persistLogs, persistStats]
  );

  const markLogViewed = useCallback(
    (logId: string) => {
      setLogs((prev) => {
        const next = prev.map((l) =>
          l.id === logId ? { ...l, viewed: true } : l
        );
        persistLogs(next);
        return next;
      });
    },
    [persistLogs]
  );

  const getPropertyLogs = useCallback(
    (propertyId: string) =>
      logs.filter((l) => l.propertyId === propertyId).sort(
        (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
      ),
    [logs]
  );

  const getPropertyScore = useCallback(
    (propertyId: string) =>
      logs
        .filter((l) => l.propertyId === propertyId)
        .reduce((sum, l) => sum + l.score, 0),
    [logs]
  );

  return (
    <AppContext.Provider
      value={{
        properties,
        logs,
        stats,
        addProperty,
        updateProperty,
        deleteProperty,
        addLog,
        markLogViewed,
        getPropertyLogs,
        getPropertyScore,
        isLoading,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used within AppProvider");
  return ctx;
}
