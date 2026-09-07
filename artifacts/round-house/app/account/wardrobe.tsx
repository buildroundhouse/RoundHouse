import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { customFetch } from "@workspace/api-client-react";
import { ADMIN_THEME, ROOMS } from "@/lib/adminTheme";
import { BrassButton, RoomShell, VelvetCard } from "@/components/admin/RoomShell";
import { useProfile } from "@/lib/profile";
import { useAuth } from "@/lib/auth";
import { wearSkin } from "@/lib/wearSkin";
import { confirm } from "@/lib/confirm";

interface DemoProfile {
  id: number;
  roleKind: string;
  displayName: string;
  demoClerkId: string;
  demoUsername: string;
  demoEmail: string;
  demoPassword: string;
  outwardAccountId: number | null;
  outwardAccountKind: string | null;
  avatarUrl: string | null;
  createdAt: string;
}

interface ListResponse {
  profiles: DemoProfile[];
  availableRoleKinds: string[];
}

/**
 * Translate raw API errors into actionable text. The most common
 * failure on the wardrobe is HTTP 401 "Admin auth required" — that
 * happens when the caller is signed in as a demo user (e.g. they
 * previously stepped into an avatar via wearSkin and never returned)
 * rather than the admin. Pointing them at the EXIT chip / sign-out
 * is far more useful than dumping the raw status line.
 */
function humanizeAdminError(e: unknown, fallback: string, prefix?: string): string {
  const raw = e instanceof Error ? e.message : fallback;
  const lead = prefix ? `${prefix} — ` : "";
  if (/401\b|Admin auth required|Unauthorized/i.test(raw)) {
    return (
      `${lead}You're not currently signed in as the admin account. ` +
      `If you're wearing a demo avatar, tap the EXIT chip in the top-right ` +
      `to return — otherwise sign out and sign back in as the admin.`
    );
  }
  return `${lead}${raw}`;
}

const ROLE_LABEL: Record<string, string> = {
  trade_pro: "Trade Pro",
  home: "Home",
  facilities: "Facility Management",
  trade_pro_teammate: "Trade Teammate",
  facilities_teammate: "Facility Teammate",
  home_teammate: "Home Teammate",
  trade_pro_collab: "Collaborator",
  facilities_collab: "Collaborator",
  collab: "Collaborator",
};

const ROLE_COLOR: Record<string, string> = {
  trade_pro: "#C95F4A",
  home: "#7BC0A8",
  facilities: "#5BA0C0",
  trade_pro_teammate: "#C8A24A",
  facilities_teammate: "#7E5BC0",
  trade_pro_collab: "#C04A8C",
  facilities_collab: "#5BC07E",
};

export default function WardrobeScreen() {
  const router = useRouter();
  const room = ROOMS.wardrobe;
  const { profile } = useProfile();
  const { user } = useAuth();
  const isAdmin = profile?.isAdmin === true;

  const [list, setList] = useState<DemoProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Suppress the safety bounce while a step-into-avatar is in
    // flight. wearSkin() signs the admin out and back in as the
    // demo user, which momentarily flips isAdmin → false. Without
    // this guard, *this* useEffect wins the race against the
    // explicit router.replace("/") inside stepInto and lands the
    // demo user directly on /(tabs), bypassing the
    // identity/intake gauntlet that root "/" routes them through.
    // Once stepInto's redirect leaves this screen, the guard
    // becomes moot.
    if (busyId) return;
    if (profile && !isAdmin) router.replace("/(tabs)");
  }, [profile, isAdmin, router, busyId]);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await customFetch<ListResponse>("/api/admin/demo-profiles");
      setList(res.profiles ?? []);
    } catch (e) {
      setError(humanizeAdminError(e, "Couldn't load avatars."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isAdmin) void reload();
  }, [isAdmin, reload]);

  const stepInto = useCallback(
    async (p: DemoProfile) => {
      // Errors are surfaced through the inline `error` card at the
      // top of the screen rather than `Alert.alert` — RN's Alert is a
      // no-op stub on react-native-web, so on the web preview every
      // failure used to silently disappear (#690 follow-up: "tap goes
      // nowhere"). The error card gives the same information visibly
      // on both web and native.
      setError(null);
      if (!user?.email) {
        setError(
          "Couldn't read your admin email — sign out and back in once before stepping into an avatar.",
        );
        return;
      }
      if (!p.demoEmail || !p.demoPassword) {
        setError("This avatar is missing its login info — recreate it.");
        return;
      }
      setBusyId(p.id);
      try {
        await wearSkin({
          adminEmail: user.email,
          demoEmail: p.demoEmail,
          demoPassword: p.demoPassword,
          demoDisplayName: p.displayName,
        });
        // Boot redirect at /index will take this new identity through
        // intake (if not done) → live profile.
        router.replace("/");
      } catch (e) {
        setBusyId(null);
        setError(humanizeAdminError(e, "Sign-in failed.", "Couldn't step into avatar"));
      }
    },
    [user?.email, router],
  );

  const submitCreate = useCallback(async () => {
    // Mirrors the regular new-profile signup: we don't ask for a role
    // kind or display name up front. The API spins up a bare-baseline
    // demo (collab kind, placeholder name) and we drop the admin into
    // the same /(onboarding)/identity → mode picker → intake gauntlet
    // a real first-time user walks through. They pick their username
    // and avatar there, exactly like a brand new account.
    //
    // Errors land in the inline `error` card (not Alert.alert, which
    // is a no-op on react-native-web — that was making API failures
    // like 401 look like the button "did nothing").
    setCreating(true);
    setError(null);
    try {
      const created = await customFetch<DemoProfile>("/api/admin/demo-profiles", {
        method: "POST",
        body: JSON.stringify({}),
      });
      await stepInto(created);
    } catch (e) {
      setError(humanizeAdminError(e, "Try again.", "Couldn't create the avatar"));
    } finally {
      setCreating(false);
    }
  }, [stepInto]);

  const remove = useCallback(
    async (p: DemoProfile) => {
      // #627: Route the destructive confirm through `lib/confirm.ts` so
      // the dialog actually surfaces on react-native-web (where bare RN
      // `Alert.alert` is a no-op stub). Native still gets a real RN
      // alert because the helper falls back to `Alert.alert` off-web.
      const ok = await confirm({
        title: "Delete this avatar?",
        message: `${p.displayName} (${ROLE_LABEL[p.roleKind] ?? p.roleKind}) will be gone for good.`,
        confirmLabel: "Delete",
        cancelLabel: "Keep",
        destructive: true,
      });
      if (!ok) return;
      setBusyId(p.id);
      try {
        await customFetch(`/api/admin/demo-profiles/${p.id}`, { method: "DELETE" });
        await reload();
      } catch (e) {
        // Inline error card — Alert.alert is a no-op on react-native-web,
        // so a 401/etc. would silently fail with no user feedback.
        setError(humanizeAdminError(e, "Try again.", "Couldn't delete the avatar"));
      } finally {
        setBusyId(null);
      }
    },
    [reload],
  );

  return (
    <RoomShell
      title={room.title}
      marquee="Backstage"
      tagline={room.tagline}
      bgGrad={room.bgGrad}
      accent={room.accent}
      glow={room.glow}
      icon={room.icon}
    >
      {error ? (
        <VelvetCard accent={room.accent}>
          <Text style={{ color: "#F4A4A4", fontSize: 13 }}>{error}</Text>
        </VelvetCard>
      ) : null}

      {loading ? (
        <View style={{ alignItems: "center", paddingVertical: 32 }}>
          <ActivityIndicator color={room.accent} />
        </View>
      ) : list.length === 0 ? (
        <VelvetCard accent={room.accent}>
          <Text style={{ color: ADMIN_THEME.bone, fontSize: 14, fontWeight: "700" }}>
            The rack is empty.
          </Text>
          <Text style={{ color: ADMIN_THEME.ash, fontSize: 12, lineHeight: 17 }}>
            Make your first avatar below — you'll walk through their intake and
            land in their live profile so you can see exactly what they see.
          </Text>
        </VelvetCard>
      ) : (
        list.map((p) => {
          const accent = ROLE_COLOR[p.roleKind] ?? room.accent;
          const isBusy = busyId === p.id;
          return (
            <Pressable
              key={p.id}
              onPress={() => stepInto(p)}
              disabled={isBusy}
              style={({ pressed }) => [
                styles.hanger,
                {
                  borderColor: accent,
                  opacity: isBusy ? 0.6 : pressed ? 0.85 : 1,
                  shadowColor: accent,
                },
              ]}
            >
              <LinearGradient
                colors={[ADMIN_THEME.emerald, ADMIN_THEME.emeraldDeep]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.hangerGrad}
              >
                <View style={styles.hangerRow}>
                  <View
                    style={[
                      styles.avatarRing,
                      { borderColor: accent, backgroundColor: "rgba(0,0,0,0.4)" },
                    ]}
                  >
                    <Feather name="user" size={26} color={accent} />
                  </View>

                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={[styles.name, { color: ADMIN_THEME.bone }]}>
                      {p.displayName}
                    </Text>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                      <View
                        style={{
                          width: 8,
                          height: 8,
                          borderRadius: 4,
                          backgroundColor: accent,
                        }}
                      />
                      <Text
                        style={{
                          color: ADMIN_THEME.ash,
                          fontSize: 11,
                          letterSpacing: 1.5,
                          textTransform: "uppercase",
                          fontWeight: "700",
                        }}
                      >
                        {ROLE_LABEL[p.roleKind] ?? p.roleKind}
                      </Text>
                    </View>
                    {p.demoUsername ? (
                      <Text style={{ color: ADMIN_THEME.ash, fontSize: 11 }}>
                        @{p.demoUsername}
                      </Text>
                    ) : null}
                  </View>

                  <View style={{ alignItems: "flex-end", gap: 8 }}>
                    <View
                      style={[
                        styles.stepBtn,
                        {
                          borderColor: accent,
                          backgroundColor: "rgba(0,0,0,0.35)",
                        },
                      ]}
                    >
                      {isBusy ? (
                        <ActivityIndicator size="small" color={accent} />
                      ) : (
                        <>
                          <Feather name="log-in" size={14} color={accent} />
                          <Text style={{ color: accent, fontSize: 11, fontWeight: "900", letterSpacing: 1.5 }}>
                            STEP IN
                          </Text>
                        </>
                      )}
                    </View>
                    <Pressable
                      onPress={(e) => {
                        e.stopPropagation();
                        remove(p);
                      }}
                      hitSlop={10}
                      accessibilityLabel={`Delete ${p.displayName}`}
                    >
                      <Feather name="trash-2" size={14} color={ADMIN_THEME.ash} />
                    </Pressable>
                  </View>
                </View>
              </LinearGradient>
            </Pressable>
          );
        })
      )}

      <VelvetCard accent={room.accent}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <Feather name="plus-circle" size={18} color={room.accent} />
          <Text
            style={{
              color: ADMIN_THEME.bone,
              fontSize: 15,
              fontWeight: "800",
              letterSpacing: 1,
              flex: 1,
            }}
          >
            STITCH A NEW AVATAR
          </Text>
        </View>
        <Text style={{ color: ADMIN_THEME.ash, fontSize: 12, lineHeight: 17 }}>
          Spins up a fresh demo identity and drops you into the same signup
          gauntlet a brand-new user walks through — pick your username and
          avatar there, then choose a role and finish intake AS them.
        </Text>
        <BrassButton
          label={creating ? "Stitching…" : "Create new avatar"}
          icon="plus"
          accent={room.accent}
          onPress={submitCreate}
        />
      </VelvetCard>
    </RoomShell>
  );
}

const styles = StyleSheet.create({
  hanger: {
    borderWidth: 1.5,
    borderRadius: 14,
    overflow: "hidden",
    shadowOpacity: 0.3,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
  },
  hangerGrad: {
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  hangerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
  },
  avatarRing: {
    width: 52,
    height: 52,
    borderRadius: 26,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  name: {
    fontSize: 16,
    fontWeight: "800",
    letterSpacing: 0.5,
  },
  stepBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1.5,
    minWidth: 92,
    justifyContent: "center",
  },
});
