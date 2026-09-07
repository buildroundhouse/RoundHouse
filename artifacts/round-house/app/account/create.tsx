import React, { useMemo, useState } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  useCreateOutwardAccount,
  useUpdateMe,
  type ServiceEntry,
} from "@workspace/api-client-react";
import {
  OutwardAccountForm,
  type OutwardAccountFormValues,
  type OutwardAccountKind,
} from "@/components/OutwardAccountForm";
import { useProfile } from "@/lib/profile";

// Mirrors PER_KIND_CREATE_CAPS in the API. The server is the source of
// truth; this is just so the UI can disable rows preemptively rather
// than letting the user fill out a whole form before being rejected.
const PER_KIND_CREATE_CAPS: Partial<Record<OutwardAccountKind, number>> = {
  trade_pro: 5,
  facilities: 5,
};

export default function CreateOutwardAccountScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const params = useLocalSearchParams<{ kind?: string }>();
  const createMutation = useCreateOutwardAccount();
  const updateMe = useUpdateMe();
  const { refetchOutwardAccounts, refetchProfile, outwardAccounts, user } =
    useProfile();
  // Brand-new users (no existing skins) almost always want their first
  // account to be active on save; established users default to off so a
  // freshly-added side persona doesn't yank them off their main feed.
  const [activate, setActivate] = useState(outwardAccounts.length === 0);
  // Services are required when signing up a new skin: every account must
  // declare at least one service it offers. Pre-populate from the user's
  // existing services so returning users don't have to re-pick.
  const [services, setServices] = useState<ServiceEntry[]>(
    (user?.services ?? []) as ServiceEntry[],
  );

  // Tally existing accounts per kind so we can grey out and label any
  // option that's already at its cap.
  const kindAvailability = useMemo(() => {
    const counts: Partial<Record<OutwardAccountKind, number>> = {};
    for (const acct of outwardAccounts) {
      const k = acct.kind as OutwardAccountKind;
      counts[k] = (counts[k] ?? 0) + 1;
    }
    const out: Partial<
      Record<OutwardAccountKind, { count: number; limit?: number }>
    > = {};
    (["trade_pro", "home", "facilities"] as const).forEach((k) => {
      out[k] = { count: counts[k] ?? 0, limit: PER_KIND_CREATE_CAPS[k] };
    });
    return out;
  }, [outwardAccounts]);

  // Honor ?kind=home / ?kind=trade_pro deeplinks (used by the "last
  // business account" recommendation sheet) but only if that kind isn't
  // already capped — otherwise fall back to the first non-capped option.
  const initialKind = useMemo<OutwardAccountKind>(() => {
    const wanted = params.kind as OutwardAccountKind | undefined;
    const order: OutwardAccountKind[] = ["home", "trade_pro", "facilities"];
    const isAvailable = (k: OutwardAccountKind) => {
      const a = kindAvailability[k];
      return !a?.limit || a.count < a.limit;
    };
    if (
      wanted &&
      (["trade_pro", "home", "facilities"] as const).includes(
        wanted as OutwardAccountKind,
      ) &&
      isAvailable(wanted)
    ) {
      return wanted;
    }
    return order.find(isAvailable) ?? "home";
  }, [params.kind, kindAvailability]);

  const initial: OutwardAccountFormValues = {
    kind: initialKind,
    title: "",
    displayName: "",
    bannerUrl: null,
    companyName: "",
    bio: "",
    // #640 — New owner-kind skins (trade_pro / home / facilities) keep
    // the full name by default so first-time visitors actually know who
    // they're dealing with. Owners can flip the toggle on per skin.
    lastInitialOnly: false,
  };

  const onSubmit = async (values: OutwardAccountFormValues) => {
    const created = await createMutation.mutateAsync({
      data: {
        kind: values.kind,
        title: values.title,
        displayName: values.displayName,
        // Avatar is shared across every outward account — it always comes
        // from the personal profile, never per-skin.
        avatarUrl: null,
        bannerUrl: values.bannerUrl,
        companyName: values.companyName.trim() ? values.companyName.trim() : null,
        bio: values.bio.trim() ? values.bio.trim() : null,
        lastInitialOnly: values.lastInitialOnly,
      },
    });
    // Persist the chosen services on the user record so they show up on
    // the new skin's profile immediately. (Per-mode service storage is
    // handled when the mode's intake is completed.)
    await updateMe.mutateAsync({ data: { services } });
    await Promise.all([refetchOutwardAccounts(), refetchProfile()]);
    if (activate) {
      // The user opted in to switching — re-scope the rest of the app to
      // the freshly-created persona's data.
      await queryClient.invalidateQueries();
    }
    if (router.canGoBack()) router.back();
    else router.replace(`/account/edit/${created.id}` as never);
  };

  return (
    <OutwardAccountForm
      initial={initial}
      submitLabel="Create account"
      onSubmit={onSubmit}
      onCancel={() => router.back()}
      showActivateToggle
      activate={activate}
      onActivateChange={setActivate}
      services={services}
      onServicesChange={setServices}
      kindAvailability={kindAvailability}
    />
  );
}
