import { useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useSessionStore } from "@/stores/session-store";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { MessagePinOperations, type MessagePinHandler } from "./message-pin-operations";

export function useMessagePin(
  serverId: string,
  agentId: string,
  client: DaemonClient | null,
  readOnly: boolean,
): MessagePinHandler | undefined {
  const { t } = useTranslation();
  const operations = useRef(new MessagePinOperations());
  const supportsWrites = useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.features?.globalStream === true,
  );
  const pin = useCallback<MessagePinHandler>(
    async (text, sourceId) => {
      if (!agentId || !client || !supportsWrites)
        throw new Error(t("globalStream.writeUnavailable"));
      await operations.current.save(serverId, agentId, text, sourceId, (input) =>
        client.updateStreamEntry(input),
      );
    },
    [serverId, agentId, client, supportsWrites, t],
  );
  return !readOnly && supportsWrites ? pin : undefined;
}
