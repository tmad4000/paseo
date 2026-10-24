import { useHostFeatureAvailability } from "@/runtime/host-features";
export function useSharingAvailability(serverId: string) {
  // COMPAT(conversationSharing): fork feature, added in fork v0.10.0-beta.17, drop the gate after 2027-04-24.
  return useHostFeatureAvailability(serverId, "conversationSharing");
}
