import { useCallback } from "react";
import { AppState } from "react-native";
import { useFocusEffect } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useAuth } from "./auth";
import { localDay } from "./daily-grind";
const seen = new Map<string, string>();
export function useDailyGrindOpening(open: () => void) {
  const { userId } = useAuth();
  useFocusEffect(
    useCallback(() => {
      if (!userId) return;
      let active = true;
      let checking = false;
      const check = async () => {
        const day = localDay();
        if (checking || seen.get(userId) === day) return;
        checking = true;
        try {
          const key = `dailyGrind.opened.v1:${userId}`;
          const previous = await AsyncStorage.getItem(key);
          if (!active) return;
          seen.set(userId, day);
          if (previous !== day) {
            open();
            await AsyncStorage.setItem(key, day);
          }
        } catch {
          if (active && seen.get(userId) !== day) {
            seen.set(userId, day);
            open();
          }
        } finally {
          checking = false;
        }
      };
      void check();
      const subscription = AppState.addEventListener("change", (state) => {
        if (state === "active") void check();
      });
      const timer = setInterval(() => {
        if (AppState.currentState === "active") void check();
      }, 60000);
      return () => {
        active = false;
        subscription.remove();
        clearInterval(timer);
      };
    }, [userId, open]),
  );
}
