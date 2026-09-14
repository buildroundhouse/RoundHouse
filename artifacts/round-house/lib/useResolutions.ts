import { useQuery } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { useAuth } from "./auth";
import { useProfile } from "./profile";
import type { Resolution } from "./resolutions";

/** The Command Center toggle and Resolution Center read the same responsibility state. */
export function useResolutions() {
  const { userId } = useAuth();
  const { activeOutwardAccountId } = useProfile();
  return useQuery({ queryKey: ["resolutions", userId, activeOutwardAccountId], enabled: !!userId,
    queryFn: () => customFetch<{ resolutions: Resolution[] }>("/api/resolutions"), refetchInterval: 30000 });
}
