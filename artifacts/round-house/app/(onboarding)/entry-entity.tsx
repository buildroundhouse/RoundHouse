import React, { useRef } from "react";
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import { IntakeForm } from "@/components/IntakeForm";
import {
  entryOwnerMode,
  readEntrySelection,
  type EntryParams,
} from "@/lib/entry-intake";
import { useActivateMode } from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { saveEntryDraft } from "@/lib/entry-draft";
import {
  formatPropertyAddress,
  readPropertyAddress,
} from "@/lib/property-address";
export default function EntryEntityScreen() {
  const params = useLocalSearchParams<EntryParams>();
  const selection = readEntrySelection(params);
  const router = useRouter(),
    { userId } = useAuth(),
    activate = useActivateMode();
  const createdMode = useRef<number | null>(null);
  if (!selection || selection.entity !== "property")
    return <Redirect href="/(onboarding)/entry" />;
  const kind = entryOwnerMode(selection);
  if (!kind)
    return (
      <Redirect
        href={{
          pathname: "/(onboarding)/entry-access",
          params: { ...selection },
        }}
      />
    );
  return (
    <IntakeForm
      intake={{
        kind,
        title: "Property address",
        intro: `${selection.propertyType === "commercial" ? "Commercial" : "Residential"} property · Owner`,
        homeTitle: "Property",
        homeSubtitle: "",
        fields: [
          {
            key: "placeAddress",
            label: "Property address",
            kind: "address",
            required: true,
          },
        ],
      }}
      onClose={() => router.back()}
      onSubmit={async (data) => {
        if (!userId) throw new Error("Please sign in again to continue.");
        if (createdMode.current === null)
          createdMode.current = (
            await activate.mutateAsync({ data: { kind } })
          ).id;
        const address = readPropertyAddress(data.propertyAddress);
        await saveEntryDraft(userId, createdMode.current, {
          selection,
          data: {
            propertyAddress: address,
            placeAddress: formatPropertyAddress(address),
          },
        });
        router.push({
          pathname: "/(onboarding)/intake",
          params: { modeId: String(createdMode.current), kind },
        });
      }}
    />
  );
}
