import { useEffect, useState } from "react";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { openShareForm } from "./share-form-model";
export function useShareForm(client: DaemonClient, agentId: string) {
  const [model] = useState(() => openShareForm(client, agentId));
  useEffect(() => {
    void model.start();
    return model.close;
  }, [model]);
  return model;
}
