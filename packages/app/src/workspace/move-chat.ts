import { create } from "zustand";
import { randomUUID } from "expo-crypto";

export interface MoveChatRequest {
  serverId: string;
  agentId: string;
  sourceWorkspaceId: string;
  title: string;
  cwd: string;
  newWorkspaceId: string;
}
export const useMoveChatStore = create<{ request: MoveChatRequest | null }>(() => ({
  request: null,
}));

export function openMoveChat(input: Omit<MoveChatRequest, "newWorkspaceId">): void {
  useMoveChatStore.setState({
    request: { ...input, newWorkspaceId: `wks_${randomUUID().replaceAll("-", "").slice(0, 16)}` },
  });
}
export function closeMoveChat(): void {
  useMoveChatStore.setState({ request: null });
}
