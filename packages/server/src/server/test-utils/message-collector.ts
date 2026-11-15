import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import type { SessionOutboundMessage } from "@getpaseo/protocol/messages";

export interface MessageCollector {
  messages: SessionOutboundMessage[];
  initialTimeline: Map<string, Awaited<ReturnType<DaemonClient["fetchAgentTimeline"]>>["entries"]>;
  clear: () => void;
  observeTimeline: (agentId: string) => Promise<void>;
  observeEvents: (events: Parameters<DaemonClient["observeEvents"]>[0]) => Promise<void>;
  observeAgents: () => Promise<void>;
  unsubscribe: () => Promise<void>;
}

export function createMessageCollector(client: DaemonClient): MessageCollector {
  const messages: SessionOutboundMessage[] = [];
  const initialTimeline: MessageCollector["initialTimeline"] = new Map();
  const detach = new Set<() => void>();
  const release = new Set<() => Promise<void>>();
  let teardown: Promise<void> | undefined;
  detach.add(
    client.subscribeRawMessages((message) => {
      messages.push(message);
    }),
  );
  type Observation =
    | ReturnType<DaemonClient["observeEvents"]>
    | ReturnType<DaemonClient["observeTimeline"]>
    | ReturnType<DaemonClient["observeAgents"]>;
  const attach = async (acquire: () => Observation) => {
    if (teardown) throw new Error("Message collector is closed");
    const observation = acquire();
    release.add(() => observation.release());
    // Raw delivery records each real wire frame once; the handle owns its producer.
    detach.add(observation.subscribe({ snapshot: () => {}, update: () => {} }));
    await observation.ready;
  };
  return {
    messages,
    initialTimeline,
    clear: () => {
      messages.length = 0;
      initialTimeline.clear();
    },
    observeTimeline: async (agentId) => {
      await attach(() => client.observeTimeline([agentId]));
      // Keep the real persisted snapshot separate from observed wire updates.
      // Setup can have started before creation returns its agent ID.
      const history = await client.fetchAgentTimeline(agentId, {
        direction: "tail",
        limit: 0,
        projection: "canonical",
      });
      initialTimeline.set(agentId, history.entries);
    },
    observeEvents: async (events) =>
      attach(() => client.observeEvents(events, { notifications: true })),
    observeAgents: async () => attach(() => client.observeAgents()),
    unsubscribe: () => {
      teardown ??= (async () => {
        for (const stop of detach) stop();
        detach.clear();
        const pending = [...release].map((stop) => stop());
        release.clear();
        await Promise.all(pending);
      })();
      return teardown;
    },
  };
}
