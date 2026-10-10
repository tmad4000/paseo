import { useMutation } from "@tanstack/react-query";
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useCallback,
  type ReactNode,
  type Dispatch,
} from "react";
import { Text, View, ScrollView } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useShallow } from "zustand/react/shallow";
import { useTranslation } from "react-i18next";
import { v4 as uuid } from "uuid";
import { Button } from "@/components/ui/button";
import { EditingTextInput, type EditingTextInputHandle } from "@/components/ui/text-input";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { useSidebarModel } from "@/components/sidebar/sidebar-model";
import { getHostRuntimeStore, useHosts } from "@/runtime/host-runtime";
import { selectAgentTurnPresentation, useSessionStore } from "@/stores/session-store";
import { SESSION_ROUTING_DRAFT_KEY as ROUTING_DRAFT_KEY } from "@/stores/draft-keys";
import {
  useDraftStore,
  awaitDraftHydration,
  flushDraftPersistStorageDurably,
} from "@/stores/draft-store";
import {
  useQueueOutboxStore,
  awaitOutboxHydration,
  type PendingQueueEnqueue,
} from "@/stores/queue-outbox-store";
import {
  useActiveWorkspaceSelection,
  navigateToWorkspace,
} from "@/stores/navigation-active-workspace-store";
import { navigateToAgent } from "@/utils/navigate-to-agent";
import { buildDraftStoreKey, generateDraftId } from "@/stores/draft-keys";
import { defaultNewConversationWorkspace, prepareNewConversationDraft } from "./new-conversation";
import { useDefaultProjectPlacements } from "@/default-project/hooks";
import { createMessageSubmissionWriter } from "@/composer/submission/writer";
import { deliverDirectRoutedPrompt, deliverRoutedPrompt } from "./delivery";
import {
  initialRoutingState,
  recipientInScope,
  routingReducer,
  selectRouteBestMatch,
  type Recipient,
  type RoutingAction,
  type RoutingState,
} from "./model";

interface MatchRequest {
  query: string;
  scope: string | null;
}
interface MatchResponse {
  recipients: Recipient[];
  notice: string;
  /** True when any selected host failed or its directory was unavailable. */
  incomplete: boolean;
}
interface ActiveMatch {
  requestId: string;
  mode: RoutingState["mode"];
  scope: string | null;
  hosts: string;
  query: string;
  draft: string;
  draftVersion: number;
  draftUpdatedAt: number;
}

function ownsRoutingDelivery(phase: RoutingState["phase"], itemId: string): boolean {
  return (phase.status === "sending" || phase.status === "pending") && phase.itemId === itemId;
}

export function SessionRoutingComposer({
  children,
}: {
  children: (submit: () => void, clear: () => void) => ReactNode;
}) {
  const { t } = useTranslation();
  const {
    searchQuery,
    setSearchQuery,
    allProjects,
    workspacePlacements,
    serverIds,
    hostRegistryLoaded,
  } = useSidebarModel();
  const defaultProjects = useDefaultProjectPlacements(allProjects);
  const [state, reduce] = useReducer(routingReducer, initialRoutingState);
  const pendingItemId =
    state.phase.status === "pending" || state.phase.status === "sending"
      ? state.phase.itemId
      : null;
  const rejection = useQueueOutboxStore((store) =>
    pendingItemId ? store.rejections[pendingItemId] : undefined,
  );
  const acknowledgement = useQueueOutboxStore((store) =>
    pendingItemId ? store.acknowledgements[pendingItemId] : undefined,
  );
  const pendingOutbox = useQueueOutboxStore(
    useShallow((store) => Object.values(store.entries).filter((entry) => entry.routingOrigin)),
  );
  const [savedDraftVersion, savedDraftUpdatedAt] = useDraftStore(
    useShallow((store) => [
      store.drafts[ROUTING_DRAFT_KEY]?.version,
      store.drafts[ROUTING_DRAFT_KEY]?.updatedAt,
    ]),
  );
  const hosts = useHosts();
  const selection = useActiveWorkspaceSelection();
  const request = useRef<string | null>(null);
  const activeMatch = useRef<ActiveMatch | null>(null);
  const submitting = useRef<string | null>(null);
  const hostMembership = JSON.stringify([...serverIds].sort());
  const latest = useRef({ state, serverIds, hostMembership, searchQuery });
  latest.current = { state, serverIds, hostMembership, searchQuery };
  const dispatch = useCallback(
    (action: RoutingAction) => {
      latest.current.state = routingReducer(latest.current.state, action);
      reduce(action);
    },
    [reduce],
  );
  const matchesContext = useCallback((context: ActiveMatch) => {
    const current = latest.current;
    if (
      current.state.mode !== context.mode ||
      current.state.scope !== context.scope ||
      current.hostMembership !== context.hosts
    )
      return false;
    if (context.mode === "find") return current.searchQuery === context.query;
    const draft = useDraftStore.getState().drafts[ROUTING_DRAFT_KEY];
    return (
      current.state.sendDraft === context.draft &&
      current.state.draftVersion === context.draftVersion &&
      current.state.draftUpdatedAt === context.draftUpdatedAt &&
      (draft?.version ?? 0) === context.draftVersion &&
      (draft?.updatedAt ?? 0) === context.draftUpdatedAt
    );
  }, []);
  const cancelMatch = useCallback(
    (requestId: string) => {
      if (request.current === requestId) request.current = null;
      if (activeMatch.current?.requestId === requestId) activeMatch.current = null;
      if (submitting.current === requestId) submitting.current = null;
      dispatch({ type: "cancelMatch", requestId });
    },
    [dispatch],
  );
  const sendInput = useRef<EditingTextInputHandle>(null);
  const agentMaps = useSessionStore(
    useShallow((snapshot) => serverIds.map((serverId) => snapshot.sessions[serverId]?.agents)),
  );
  const currentProject = workspacePlacements.find(
    (placement) =>
      placement.serverId === selection?.serverId &&
      placement.workspaceId === selection?.workspaceId,
  );
  const manualRecipients = useMemo(() => {
    const byWorkspace = new Map(
      workspacePlacements.map((placement) => [
        JSON.stringify([placement.serverId, placement.workspaceId]),
        placement,
      ]),
    );
    const recipients: Recipient[] = [];
    for (const agents of agentMaps) {
      if (!agents) continue;
      for (const agent of agents.values()) {
        if (agent.archivedAt || agent.parentAgentId || !agent.workspaceId) continue;
        const placement = byWorkspace.get(JSON.stringify([agent.serverId, agent.workspaceId]));
        const workspace = useSessionStore
          .getState()
          .sessions[agent.serverId]?.workspaces.get(agent.workspaceId);
        if (!placement || !workspace) continue;
        recipients.push({
          serverId: agent.serverId,
          agentId: agent.id,
          workspaceId: agent.workspaceId,
          projectId: workspace.projectId,
          projectName: placement.projectName,
          projectViewKey: placement.projectViewKey,
          hostLabel:
            hosts.find((host) => host.serverId === agent.serverId)?.label ?? agent.serverId,
          title: agent.title || placement.name,
          excerpt: "",
          confidence: 0,
        });
      }
    }
    return recipients;
  }, [agentMaps, hosts, workspacePlacements]);

  const recipientDirectory = useRef({ manualRecipients, hosts });
  recipientDirectory.current = { manualRecipients, hosts };

  const match = useMutation({
    mutationFn: async ({ query, scope }: MatchRequest): Promise<MatchResponse> => {
      const scoped = workspacePlacements.filter(
        (placement) => scope === null || placement.projectViewKey === scope,
      );
      const hostIds = serverIds;
      const responses = await Promise.allSettled(
        hostIds.map(async (serverId) => {
          const session = useSessionStore.getState().sessions[serverId];
          if (!session?.hasHydratedWorkspaces)
            throw new Error(t("sidebar.routing.directoryUnavailable"));
          const workspaceIds = scoped
            .filter((placement) => placement.serverId === serverId)
            .map((placement) => placement.workspaceId);
          if (workspaceIds.length === 0) return { recipients: [], searched: 0, total: 0 };
          if (!session?.serverInfo?.features?.sessionSearch)
            throw new Error(t("sidebar.routing.updateHost"));
          const client = getHostRuntimeStore().getClient(serverId);
          if (!client || client.getConnectionState().status !== "connected")
            throw new Error(t("sidebar.routing.offline"));
          const payload = await client.searchSessions({
            query,
            workspaceIds,
          });
          const recipients: Recipient[] = [];
          for (const result of payload.results) {
            const placement = scoped.find(
              (entry) => entry.serverId === serverId && entry.workspaceId === result.workspaceId,
            );
            if (!placement) throw new Error(t("sidebar.routing.invalidDestination"));
            recipients.push({
              ...result,
              serverId,
              projectViewKey: placement.projectViewKey,
              hostLabel: hosts.find((host) => host.serverId === serverId)?.label ?? serverId,
            });
          }
          return { recipients, searched: payload.searchedCount, total: payload.totalCount };
        }),
      );
      const recipients: Recipient[] = [];
      const failures: string[] = hostRegistryLoaded
        ? []
        : [t("sidebar.routing.directoryUnavailable")];
      let searched = 0,
        total = 0;
      for (const response of responses) {
        if (response.status === "rejected") {
          failures.push(
            response.reason instanceof Error
              ? response.reason.message
              : t("sidebar.routing.matchFailed"),
          );
          continue;
        }
        recipients.push(...response.value.recipients);
        searched += response.value.searched;
        total += response.value.total;
      }
      recipients.sort((a, b) => b.confidence - a.confidence);
      const notices = failures.map((message) => message.slice(0, 240));
      notices.push(
        t(searched < total ? "sidebar.routing.searchLimit" : "sidebar.routing.searchCoverage", {
          searched,
          total,
        }),
      );
      return {
        recipients,
        notice: notices.join(" "),
        incomplete: failures.length > 0,
      };
    },
  });

  const delivery = useMutation({
    mutationFn: async (input: {
      recipient: Recipient;
      text: string;
      itemId: string;
      draftVersion: number;
      draftUpdatedAt?: number;
      requireExisting?: boolean;
    }) => {
      if (!latest.current.serverIds.includes(input.recipient.serverId))
        throw new Error(t("sidebar.routing.invalidDestination"));
      const client = getHostRuntimeStore().getClient(input.recipient.serverId);
      if (!client) throw new Error(t("sidebar.routing.offline"));
      const session = useSessionStore.getState().sessions[input.recipient.serverId];
      if (
        !session?.serverInfo?.features?.sessionSearch ||
        !session.serverInfo.features.agentMessageQueue
      )
        throw new Error(t("sidebar.routing.updateHost"));
      return deliverRoutedPrompt({
        ...input,
        client,
        isHostEligible: () => {
          const features = client.getLastServerInfoMessage()?.features;
          return (
            latest.current.serverIds.includes(input.recipient.serverId) &&
            features?.sessionSearch === true &&
            features.agentMessageQueue === true
          );
        },
        outbox: useQueueOutboxStore.getState(),
        applySnapshot: (snapshot) =>
          useSessionStore.getState().applyAgentQueueSnapshot(input.recipient.serverId, snapshot),
      });
    },
  });

  const locked = isRoutingLocked(state);
  // Validate the currently owned lookup before input becomes interactive. A
  // delayed passive effect from an older render must never cancel a newer one.
  useLayoutEffect(() => {
    const context = activeMatch.current;
    if (context && !matchesContext(context)) cancelMatch(context.requestId);
  });
  useEffect(() => {
    dispatch({ type: "hosts", serverIds: latest.current.serverIds });
  }, [hostMembership, state.recipient?.serverId, dispatch]);
  useEffect(() => {
    let active = true;
    void Promise.all([awaitDraftHydration(), awaitOutboxHydration()])
      .then(async () => {
        if (useDraftStore.getState().drafts[ROUTING_DRAFT_KEY]?.routingClear)
          await useQueueOutboxStore.getState().recoverRoutingDraft();
        await useDraftStore.getState().hydrateDraftInput({ draftKey: ROUTING_DRAFT_KEY });
        if (!active) return undefined;
        // Migration/acknowledgement may change the record during an await. Read
        // the text and ownership together only after both persisted stores load.
        const draftStore = useDraftStore.getState();
        const record = draftStore.drafts[ROUTING_DRAFT_KEY];
        const entry = Object.values(useQueueOutboxStore.getState().entries).find(
          (pending) =>
            pending.routingOrigin &&
            pending.routingDraftVersion === (record?.version ?? 0) &&
            pending.routingDraftUpdatedAt === (record?.updatedAt ?? 0),
        );
        dispatch({
          type: "restoreDraft",
          text: draftStore.getDraftInput(ROUTING_DRAFT_KEY)?.text ?? "",
          version: record?.version ?? 0,
          updatedAt: record?.updatedAt ?? 0,
          pending: entry
            ? pendingRecovery(
                entry,
                recipientDirectory.current.manualRecipients,
                recipientDirectory.current.hosts,
              )
            : undefined,
        });
        return undefined;
      })
      .catch(() => {
        if (active)
          dispatch({
            type: "phase",
            phase: { status: "error", message: t("sidebar.routing.draftLoadFailed") },
          });
      });
    return () => {
      active = false;
    };
  }, [t, dispatch]);
  useEffect(() => {
    if (
      !state.draftReady ||
      state.phase.status === "sending" ||
      state.phase.status === "pending" ||
      state.phase.status === "handoff"
    )
      return;
    const entry = pendingOutbox.find(
      (pending) =>
        pending.routingDraftVersion === state.draftVersion &&
        pending.routingDraftUpdatedAt === state.draftUpdatedAt,
    );
    if (!entry) return;
    dispatch(pendingRecovery(entry, manualRecipients, hosts));
  }, [
    manualRecipients,
    hosts,
    pendingOutbox,
    state.draftReady,
    state.phase.status,
    state.sendDraft,
    state.draftVersion,
    state.draftUpdatedAt,
    dispatch,
  ]);
  useEffect(() => {
    if ((state.phase.status === "pending" || state.phase.status === "sending") && rejection)
      dispatch({ type: "phase", phase: { status: "error", message: rejection } });
  }, [rejection, state.phase.status, dispatch]);
  useEffect(() => {
    if (
      state.phase.status !== "pending" ||
      !acknowledgement ||
      useQueueOutboxStore.getState().entries[state.phase.itemId]?.removalRequested
    )
      return;
    dispatch({ type: "acknowledged", itemId: state.phase.itemId, queued: acknowledgement.queued });
  }, [acknowledgement, state.phase, dispatch]);
  useEffect(() => {
    if (
      !state.draftReady ||
      savedDraftVersion === undefined ||
      (savedDraftVersion === state.draftVersion && savedDraftUpdatedAt === state.draftUpdatedAt)
    )
      return;
    const draft = useDraftStore.getState().getDraftInput(ROUTING_DRAFT_KEY);
    if (draft)
      dispatch({
        type: "syncDraft",
        text: draft.text,
        version: savedDraftVersion,
        updatedAt: useDraftStore.getState().drafts[ROUTING_DRAFT_KEY]?.updatedAt ?? 0,
      });
  }, [
    savedDraftVersion,
    savedDraftUpdatedAt,
    state.draftReady,
    state.draftVersion,
    state.draftUpdatedAt,
    dispatch,
  ]);
  useEffect(() => {
    if (sendInput.current && sendInput.current.getText() !== state.sendDraft)
      sendInput.current.replaceText(state.sendDraft);
  }, [state.sendDraft, state.draftVersion]);
  useEffect(
    () => () => {
      request.current = null;
      activeMatch.current = null;
    },
    [],
  );

  const send = useCallback(
    async (
      recipient: Recipient,
      text: string,
      itemId = uuid(),
      draftVersion = state.draftVersion,
      draftUpdatedAt = state.draftUpdatedAt,
      options?: { forceQueue?: boolean; route?: boolean },
    ) => {
      const current = latest.current;
      const retry =
        current.state.phase.status === "pending" && current.state.phase.itemId === itemId;
      if (!canSendRoutedPrompt(current.state, current.serverIds, recipient, retry)) return;
      request.current = null;
      const route = options?.route;
      dispatch({
        type: "phase",
        phase: { status: "sending", recipient, text, itemId, draftVersion, draftUpdatedAt, route },
      });
      // The route verb only ever queues; it never steers or interrupts a running agent.
      const mode = retry || options?.forceQueue ? "queue" : current.state.deliveryMode;
      if (mode !== "queue") {
        await sendDirectFromComposer({
          recipient,
          text,
          mode,
          itemId,
          draftVersion,
          draftUpdatedAt,
          getCurrent: () => latest.current,
          dispatch,
        });
        return;
      }
      try {
        const result = await delivery.mutateAsync({
          recipient,
          text,
          itemId,
          draftVersion,
          draftUpdatedAt,
          requireExisting: retry,
        });
        dispatch({ type: "acknowledged", itemId, queued: result.queued });
      } catch (error) {
        const phase = latest.current.state.phase;
        if (!ownsRoutingDelivery(phase, itemId)) return;
        const message = error instanceof Error ? error.message : t("sidebar.routing.sendFailed");
        const deliveryAcknowledgement = useQueueOutboxStore.getState().acknowledgements[itemId];
        const stored = useQueueOutboxStore.getState().entries[itemId];
        const deliveryRejection = useQueueOutboxStore.getState().rejections[itemId];
        if (deliveryRejection)
          dispatch({ type: "phase", phase: { status: "error", message: deliveryRejection } });
        else if (deliveryAcknowledgement && !stored?.removalRequested)
          dispatch({ type: "acknowledged", itemId, queued: deliveryAcknowledgement.queued });
        else if (!stored) dispatch({ type: "phase", phase: { status: "error", message } });
        else
          dispatch({
            type: "phase",
            phase: {
              status: "pending",
              recipient,
              text,
              itemId,
              draftVersion,
              draftUpdatedAt,
              error: message,
              route,
            },
          });
      }
    },
    [delivery, state.draftVersion, state.draftUpdatedAt, t, dispatch],
  );

  const newWorkspaceEligible = useCallback(() => {
    const workspace = latest.current.state.newWorkspace;
    return Boolean(
      workspace &&
      latest.current.serverIds.includes(workspace.serverId) &&
      (latest.current.state.scope === null ||
        workspace.projectViewKey === latest.current.state.scope) &&
      useSessionStore
        .getState()
        .sessions[workspace.serverId]?.workspaces.has(workspace.workspaceId),
    );
  }, []);
  const continueNewConversation = useCallback(async () => {
    const current = latest.current.state;
    if (
      !current.newWorkspace ||
      !current.sendDraft.trim() ||
      submitting.current ||
      isRoutingLocked(current)
    )
      return;
    const workspace = current.newWorkspace;
    const draftId = generateDraftId();
    submitting.current = draftId;
    dispatch({ type: "phase", phase: { status: "handoff" } });
    try {
      await prepareNewConversationDraft({
        workspace,
        text: current.sendDraft,
        draftId,
        save: (id, text) =>
          useDraftStore.getState().saveDraftInput({
            draftKey: buildDraftStoreKey({
              serverId: workspace.serverId,
              agentId: id,
              draftId: id,
            }),
            draft: { text, attachments: [] },
          }),
        flush: flushDraftPersistStorageDurably,
        isEligible: () =>
          newWorkspaceEligible() &&
          latest.current.state.mode === "send" &&
          latest.current.state.newConversation &&
          latest.current.state.newWorkspace?.serverId === current.newWorkspace?.serverId &&
          latest.current.state.newWorkspace?.workspaceId === current.newWorkspace?.workspaceId,
        navigate: navigateToWorkspace,
      });
      dispatch({ type: "phase", phase: { status: "idle" } });
    } catch (error) {
      dispatch({
        type: "phase",
        phase: {
          status: "error",
          message: error instanceof Error ? error.message : t("sidebar.routing.sendFailed"),
        },
      });
    } finally {
      if (submitting.current === draftId) submitting.current = null;
    }
  }, [newWorkspaceEligible, t, dispatch]);

  const submit = useCallback(async () => {
    const current = latest.current;
    const submitted = current.state;
    if (submitted.mode === "send" && submitted.newConversation) {
      await continueNewConversation();
      return;
    }
    if (submitting.current || isRoutingLocked(submitted)) return;
    const text = submitted.mode === "find" ? current.searchQuery : submitted.sendDraft;
    if (!text.trim()) return;
    const mode = submitted.mode;
    const requestId = uuid();
    const context: ActiveMatch = {
      requestId,
      mode,
      scope: submitted.scope,
      hosts: current.hostMembership,
      query: current.searchQuery,
      draft: submitted.sendDraft,
      draftVersion: submitted.draftVersion,
      draftUpdatedAt: submitted.draftUpdatedAt,
    };
    const isCurrentMatch = () => {
      const matchCurrent = latest.current;
      return (
        request.current === requestId &&
        matchCurrent.state.phase.status === "matching" &&
        matchCurrent.state.phase.requestId === requestId &&
        matchesContext(context)
      );
    };
    submitting.current = requestId;
    try {
      if (mode === "send" && submitted.recipient) {
        await send(
          submitted.recipient,
          text,
          undefined,
          submitted.draftVersion,
          submitted.draftUpdatedAt,
        );
        return;
      }
      request.current = requestId;
      activeMatch.current = context;
      dispatch({ type: "phase", phase: { status: "matching", requestId, mode, text } });
      const result = await match.mutateAsync({ query: text, scope: submitted.scope });
      if (!isCurrentMatch()) {
        cancelMatch(requestId);
        return;
      }
      request.current = null;
      activeMatch.current = null;
      dispatch({
        type: "matched",
        requestId,
        recipients: result.recipients,
        notice: result.notice,
      });
    } catch (error) {
      if (!isCurrentMatch()) {
        cancelMatch(requestId);
        return;
      }
      dispatch({
        type: "phase",
        phase: {
          status: "error",
          message: error instanceof Error ? error.message : t("sidebar.routing.matchFailed"),
        },
      });
    } finally {
      if (submitting.current === requestId) submitting.current = null;
    }
  }, [match, send, t, dispatch, matchesContext, cancelMatch, continueNewConversation]);

  // The explicit route verb: one action chaining search → select → deliver.
  // It queues only, auto-selects solely under the documented threshold+margin
  // gate, and otherwise falls back to the ordinary candidate list with the
  // draft preserved. Passive Find/Send matching is unchanged.
  const routeToBestMatch = useCallback(async () => {
    const current = latest.current;
    const submitted = current.state;
    if (submitting.current || isRoutingLocked(submitted)) return;
    if (submitted.mode !== "send" || submitted.newConversation || submitted.recipient) return;
    const text = submitted.sendDraft;
    if (!text.trim()) return;
    const requestId = uuid();
    const context: ActiveMatch = {
      requestId,
      mode: "send",
      scope: submitted.scope,
      hosts: current.hostMembership,
      query: current.searchQuery,
      draft: text,
      draftVersion: submitted.draftVersion,
      draftUpdatedAt: submitted.draftUpdatedAt,
    };
    const isCurrentMatch = () => {
      const matchCurrent = latest.current;
      return (
        request.current === requestId &&
        matchCurrent.state.phase.status === "matching" &&
        matchCurrent.state.phase.requestId === requestId &&
        matchesContext(context)
      );
    };
    submitting.current = requestId;
    try {
      request.current = requestId;
      activeMatch.current = context;
      dispatch({
        type: "phase",
        phase: { status: "matching", requestId, mode: "send", text, route: true },
      });
      const result = await match.mutateAsync({ query: text, scope: submitted.scope });
      if (!isCurrentMatch()) {
        cancelMatch(requestId);
        return;
      }
      request.current = null;
      activeMatch.current = null;
      const inScope = result.recipients.filter((recipient) =>
        recipientInScope(recipient, context.scope),
      );
      // Never auto-select from partial coverage: a failed host could hide the
      // real destination, so an incomplete search always asks.
      const best = result.incomplete ? null : selectRouteBestMatch(inScope);
      if (!best) {
        dispatch({
          type: "matched",
          requestId,
          recipients: result.recipients,
          notice: result.notice,
        });
        return;
      }
      await send(best, text, undefined, context.draftVersion, context.draftUpdatedAt, {
        forceQueue: true,
        route: true,
      });
    } catch (error) {
      if (!isCurrentMatch()) {
        cancelMatch(requestId);
        return;
      }
      dispatch({
        type: "phase",
        phase: {
          status: "error",
          message: error instanceof Error ? error.message : t("sidebar.routing.matchFailed"),
        },
      });
    } finally {
      if (submitting.current === requestId) submitting.current = null;
    }
  }, [match, send, t, dispatch, matchesContext, cancelMatch]);

  const select = useCallback(
    (recipient: Recipient | null) => {
      const current = latest.current;
      if (current.state.phase.status === "sending" || current.state.phase.status === "pending")
        return;
      if (
        recipient &&
        (!current.serverIds.includes(recipient.serverId) ||
          !recipientInScope(recipient, current.state.scope))
      )
        return;
      if (request.current && submitting.current === request.current) submitting.current = null;
      request.current = null;
      dispatch({ type: "recipient", recipient });
    },
    [dispatch],
  );
  const open = useCallback((recipient: Recipient) => {
    navigateToAgent({
      serverId: recipient.serverId,
      agentId: recipient.agentId,
      workspaceId: recipient.workspaceId,
    });
  }, []);
  const setFindMode = useCallback(() => {
    dispatch({ type: "mode", mode: "find" });
  }, [dispatch]);
  const setSendMode = useCallback(() => {
    dispatch({ type: "mode", mode: "send" });
  }, [dispatch]);
  const setAllProjects = useCallback(() => {
    dispatch({ type: "scope", scope: null });
  }, [dispatch]);
  const setCurrentProject = useCallback(() => {
    if (currentProject) dispatch({ type: "scope", scope: currentProject.projectViewKey });
  }, [currentProject, dispatch]);
  const togglePicker = useCallback(() => {
    dispatch({ type: "picker", open: !state.picker });
  }, [state.picker, dispatch]);
  const openPicker = useCallback(() => {
    dispatch({ type: "picker", open: true });
  }, [dispatch]);
  const setDraft = useCallback(
    (text: string) => {
      if (isRoutingLocked(latest.current.state)) return;
      useDraftStore.getState().editDraftText({ draftKey: ROUTING_DRAFT_KEY, text });
      dispatch({
        type: "draft",
        text,
        version: useDraftStore.getState().drafts[ROUTING_DRAFT_KEY]?.version ?? 0,
        updatedAt: useDraftStore.getState().drafts[ROUTING_DRAFT_KEY]?.updatedAt ?? 0,
      });
    },
    [dispatch],
  );
  const clearInput = useCallback(() => {
    if (isRoutingLocked(latest.current.state)) return;
    if (request.current) cancelMatch(request.current);
    if (latest.current.state.mode === "find") setSearchQuery("");
    else setDraft("");
    dispatch({ type: "clear" });
  }, [cancelMatch, dispatch, setDraft, setSearchQuery]);
  const resultsStale =
    state.phase.status === "results" &&
    state.phase.text !== (state.mode === "find" ? searchQuery : state.sendDraft);
  const setPickerQuery = useCallback(
    (text: string) => {
      dispatch({ type: "pickerQuery", text });
    },
    [dispatch],
  );
  const selectNewConversation = useCallback(() => {
    if (request.current) cancelMatch(request.current);
    const current = latest.current.state;
    dispatch({
      type: "newConversation",
      workspace:
        current.newWorkspace ??
        defaultNewConversationWorkspace({
          workspaces: workspacePlacements,
          serverIds,
          scope: current.scope,
          active: selection,
          defaultProjects,
        }),
    });
  }, [cancelMatch, dispatch, workspacePlacements, serverIds, selection, defaultProjects]);
  const selectAutomatic = useCallback(() => {
    select(null);
  }, [select]);
  const submitFromButton = useCallback(() => {
    void submit();
  }, [submit]);
  const sendChoice = useCallback(
    (recipient: Recipient) => {
      if (submitting.current) return;
      const submissionId = uuid();
      submitting.current = submissionId;
      const current = latest.current.state;
      if (!current.sendDraft.trim()) {
        submitting.current = null;
        return;
      }
      void send(
        recipient,
        current.sendDraft,
        undefined,
        current.draftVersion,
        current.draftUpdatedAt,
      ).finally(() => {
        if (submitting.current === submissionId) submitting.current = null;
      });
    },
    [send],
  );
  const retryDelivery = useCallback(() => {
    const phase = state.phase;
    if (phase.status !== "pending" || submitting.current) return;
    const submissionId = uuid();
    submitting.current = submissionId;
    void send(phase.recipient, phase.text, phase.itemId, phase.draftVersion, phase.draftUpdatedAt, {
      route: phase.route,
    }).finally(() => {
      if (submitting.current === submissionId) submitting.current = null;
    });
  }, [send, state.phase]);
  // "Wrong chat → move draft": restore the routed prompt and reopen the manual
  // chooser. The queued copy keeps its durable-outbox semantics; this only
  // brings the draft back for re-routing.
  const moveDraft = useCallback(() => {
    const phase = latest.current.state.phase;
    if (phase.status !== "acknowledged" || !phase.route) return;
    if (!latest.current.state.sendDraft.trim()) setDraft(phase.route.text);
    dispatch({ type: "phase", phase: { status: "idle" } });
    dispatch({ type: "picker", open: true });
  }, [dispatch, setDraft]);
  const routeFromButton = useCallback(() => {
    void routeToBestMatch();
  }, [routeToBestMatch]);
  const scopeName =
    allProjects.find((project) => project.viewKey === state.scope)?.projectName ??
    t("sidebar.routing.allProjects");
  const pickerQuery = state.pickerQuery.normalize("NFKC").toLocaleLowerCase();
  const pickerRecipients = manualRecipients.filter(
    (recipient) =>
      recipientInScope(recipient, state.scope) &&
      `${recipient.projectName} ${recipient.title} ${recipient.hostLabel}`
        .normalize("NFKC")
        .toLocaleLowerCase()
        .includes(pickerQuery),
  );

  return (
    <View style={styles.container} testID="session-routing-composer">
      <View style={styles.row}>
        <Button
          size="xs"
          variant={state.mode === "find" ? "secondary" : "ghost"}
          disabled={locked}
          accessibilityLabel={t("sidebar.routing.findMode")}
          testID="routing-find-mode"
          onPress={setFindMode}
        >
          {t("sidebar.routing.find")}
        </Button>
        <Button
          size="xs"
          variant={state.mode === "send" ? "secondary" : "ghost"}
          disabled={locked}
          accessibilityLabel={t("sidebar.routing.sendMode")}
          testID="routing-send-mode"
          onPress={setSendMode}
        >
          {t("sidebar.routing.sendPrompt")}
        </Button>
        <DropdownMenu compactMode="sheet">
          <DropdownMenuTrigger
            disabled={locked}
            accessibilityRole="button"
            accessibilityLabel={t("sidebar.routing.scope", { name: scopeName })}
            testID="routing-scope"
          >
            <Text style={styles.muted} numberOfLines={1}>
              {scopeName}
            </Text>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" sheetTitle={t("sidebar.routing.chooseScope")}>
            <DropdownMenuItem onSelect={setAllProjects}>
              {t("sidebar.routing.allProjects")}
            </DropdownMenuItem>
            {currentProject ? (
              <DropdownMenuItem onSelect={setCurrentProject}>
                {t("sidebar.routing.currentProject", { name: currentProject.projectName })}
              </DropdownMenuItem>
            ) : null}
            {allProjects.map((project) => (
              <RoutingScopeOption
                key={project.viewKey}
                name={project.projectName}
                scope={project.viewKey}
                dispatch={dispatch}
              />
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </View>
      {state.mode === "find" ? (
        children(submitFromButton, clearInput)
      ) : (
        <>
          <RoutingDestinationControls
            state={state}
            locked={locked}
            togglePicker={togglePicker}
            selectNewConversation={selectNewConversation}
            dispatch={dispatch}
            hosts={hosts}
            workspaces={workspacePlacements}
            serverIds={serverIds}
          />
          <EditingTextInput
            ref={sendInput}
            key="send"
            initialValue={state.sendDraft}
            onChangeText={setDraft}
            editable={!locked}
            multiline
            placeholder={t("sidebar.routing.promptPlaceholder")}
            accessibilityLabel={t("sidebar.routing.promptPlaceholder")}
            testID="routing-send-draft"
            style={styles.input}
          />
        </>
      )}
      {state.picker ? (
        <View style={styles.results}>
          <EditingTextInput
            initialValue={state.pickerQuery}
            onChangeText={setPickerQuery}
            placeholder={t("sidebar.routing.pickPlaceholder")}
            accessibilityLabel={t("sidebar.routing.pickPlaceholder")}
            testID="routing-picker-query"
            style={styles.input}
          />
          <Button size="sm" variant="ghost" onPress={selectAutomatic}>
            {t("sidebar.routing.automatic")}
          </Button>
          <ScrollView style={styles.resultScroll}>
            {pickerRecipients.map((recipient) => (
              <PickerRecipientRow
                key={JSON.stringify([recipient.serverId, recipient.agentId])}
                recipient={recipient}
                onSelect={select}
              />
            ))}
          </ScrollView>
          {pickerRecipients.length === 0 ? (
            <Text style={styles.muted}>{t("sidebar.routing.noChats")}</Text>
          ) : null}
        </View>
      ) : null}
      <View style={styles.row}>
        <Text style={styles.hint}>
          {state.mode === "find"
            ? t("sidebar.routing.searchOnly")
            : t("sidebar.routing.repliesThere")}
        </Text>
        <Button
          size="xs"
          variant="ghost"
          disabled={isClearDisabled(state, searchQuery, locked)}
          onPress={clearInput}
          accessibilityLabel={t(
            state.mode === "find" ? "sidebar.routing.clearSearch" : "sidebar.routing.clearPrompt",
          )}
          testID="routing-clear-input"
        >
          {t("sidebar.routing.clear")}
        </Button>
        <RouteBestMatchButton state={state} locked={locked} onPress={routeFromButton} />
        <Button
          size="xs"
          disabled={isSubmitDisabled(state, searchQuery, locked, newWorkspaceEligible())}
          loading={isLookupOrDeliveryActive(state.phase) && !isRoutePhaseActive(state.phase)}
          onPress={submitFromButton}
          accessibilityLabel={t(routingSubmitLabel(state))}
          testID="routing-submit"
        >
          {t(submitButtonLabel(state))}
        </Button>
      </View>
      <RoutingOutcome
        phase={state.phase}
        resultsStale={resultsStale}
        deliveryMode={state.deliveryMode}
        canSend={Boolean(state.sendDraft.trim()) && !locked}
        onSelect={select}
        onOpen={open}
        onSend={sendChoice}
        onRetry={retryDelivery}
        onMoveDraft={moveDraft}
      />
      <RoutingNoResultActions
        phase={state.phase}
        onChooseChat={openPicker}
        onNewConversation={selectNewConversation}
      />
    </View>
  );
}

function isLookupOrDeliveryActive(phase: RoutingState["phase"]): boolean {
  return phase.status === "matching" || phase.status === "sending";
}

function isRoutePhaseActive(phase: RoutingState["phase"]): boolean {
  return (phase.status === "matching" || phase.status === "sending") && phase.route === true;
}

function RouteBestMatchButton({
  state,
  locked,
  onPress,
}: {
  state: RoutingState;
  locked: boolean;
  onPress: () => void;
}) {
  const { t } = useTranslation();
  if (state.mode !== "send" || state.newConversation) return null;
  return (
    <Button
      size="xs"
      variant="outline"
      disabled={locked || !state.sendDraft.trim() || state.recipient !== null}
      loading={isRoutePhaseActive(state.phase)}
      onPress={onPress}
      accessibilityLabel={t("sidebar.routing.routeBestMatchAction")}
      testID="routing-route-best"
    >
      {t("sidebar.routing.routeBestMatch")}
    </Button>
  );
}

function RoutingNoResultActions({
  phase,
  onChooseChat,
  onNewConversation,
}: {
  phase: RoutingState["phase"];
  onChooseChat: () => void;
  onNewConversation: () => void;
}) {
  const { t } = useTranslation();
  if (phase.status !== "results" || phase.recipients.length > 0) return null;
  return (
    <>
      <Button size="sm" variant="outline" onPress={onChooseChat}>
        {t("sidebar.routing.chooseChat")}
      </Button>
      {phase.route ? (
        <Button size="sm" variant="outline" onPress={onNewConversation}>
          {t("sidebar.routing.routeNewConversation")}
        </Button>
      ) : null}
    </>
  );
}

function isClearDisabled(state: RoutingState, query: string, locked: boolean): boolean {
  return (
    locked || (!(state.mode === "find" ? query : state.sendDraft) && state.phase.status === "idle")
  );
}

function isRoutingLocked(state: RoutingState): boolean {
  return (
    !state.draftReady ||
    state.phase.status === "sending" ||
    state.phase.status === "pending" ||
    state.phase.status === "handoff"
  );
}

function pendingRecovery(
  entry: PendingQueueEnqueue,
  recipients: readonly Recipient[],
  hosts: readonly { serverId: string; label?: string }[],
): Extract<RoutingAction, { type: "restorePending" }> {
  const display = recipients.find(
    (candidate) => candidate.serverId === entry.serverId && candidate.agentId === entry.agentId,
  );
  const sameDestination =
    display &&
    display.workspaceId === entry.expectedWorkspaceId &&
    display.projectId === entry.expectedProjectId;
  const recipient: Recipient = {
    serverId: entry.serverId,
    agentId: entry.agentId,
    workspaceId: entry.expectedWorkspaceId ?? "",
    projectId: entry.expectedProjectId ?? "",
    projectName: sameDestination
      ? display.projectName
      : (entry.expectedProjectId ?? entry.serverId),
    projectViewKey: sameDestination ? display.projectViewKey : "",
    hostLabel: hosts.find((host) => host.serverId === entry.serverId)?.label ?? entry.serverId,
    title: display?.title ?? entry.agentId,
    excerpt: "",
    confidence: 0,
  };
  return {
    type: "restorePending",
    recipient,
    text: entry.text,
    itemId: entry.itemId,
    draftVersion: entry.routingDraftVersion ?? 0,
    draftUpdatedAt: entry.routingDraftUpdatedAt,
  };
}

function RoutingOutcome({
  phase,
  resultsStale,
  deliveryMode,
  canSend,
  onSelect,
  onOpen,
  onSend,
  onRetry,
  onMoveDraft,
}: {
  phase: import("./model").RoutingPhase;
  resultsStale: boolean;
  deliveryMode: RoutingState["deliveryMode"];
  canSend: boolean;
  onSelect: (recipient: Recipient) => void;
  onOpen: (recipient: Recipient) => void;
  onSend: (recipient: Recipient) => void;
  onRetry: () => void;
  onMoveDraft: () => void;
}) {
  const { t } = useTranslation();
  const openReceipt = useCallback(() => {
    if ("recipient" in phase) onOpen(phase.recipient);
  }, [phase, onOpen]);
  if (phase.status === "error")
    return (
      <Text accessibilityLiveRegion="polite" style={styles.muted}>
        {phase.message}
      </Text>
    );
  if (phase.status === "pending")
    return (
      <View style={styles.results}>
        <Text accessibilityLiveRegion="polite" style={styles.muted}>
          {t("sidebar.routing.awaitingAck")} {phase.error}
        </Text>
        <Button size="sm" variant="outline" onPress={onRetry}>
          {t("sidebar.routing.retry")}
        </Button>
        <Button size="sm" variant="ghost" onPress={openReceipt}>
          {t("sidebar.routing.openChat")}
        </Button>
      </View>
    );
  if (phase.status === "acknowledged")
    return (
      <View style={styles.results}>
        <Text accessibilityLiveRegion="polite" style={styles.receipt}>
          {t(phase.queued ? "sidebar.routing.queuedTo" : "sidebar.routing.routedTo", {
            project: phase.recipient.projectName,
            chat: phase.recipient.title,
          })}
        </Text>
        {phase.warning ? <Text style={styles.muted}>{phase.warning}</Text> : null}
        <Button size="sm" variant="ghost" onPress={openReceipt}>
          {t("sidebar.routing.openChat")}
        </Button>
        {phase.route ? (
          <Button size="sm" variant="outline" onPress={onMoveDraft} testID="routing-move-draft">
            {t("sidebar.routing.moveDraft")}
          </Button>
        ) : null}
      </View>
    );
  if (phase.status !== "results") return null;
  let headingKey:
    | "sidebar.routing.noMatch"
    | "sidebar.routing.found"
    | "sidebar.routing.disambiguate"
    | "sidebar.routing.routeAmbiguous" = "sidebar.routing.noMatch";
  if (phase.recipients.length > 0 && phase.mode === "find") headingKey = "sidebar.routing.found";
  else if (phase.recipients.length > 0)
    headingKey = phase.route ? "sidebar.routing.routeAmbiguous" : "sidebar.routing.disambiguate";
  return (
    <View style={styles.results}>
      {phase.notice ? <Text style={styles.muted}>{phase.notice}</Text> : null}
      {resultsStale ? (
        <Text style={styles.muted}>{t("sidebar.routing.previousResults")}</Text>
      ) : null}
      <Text accessibilityLiveRegion="polite" style={styles.muted}>
        {t(headingKey)}
      </Text>
      <ScrollView style={styles.resultScroll}>
        {phase.recipients.map((recipient) => (
          <RoutingResult
            key={JSON.stringify([recipient.serverId, recipient.agentId])}
            recipient={recipient}
            mode={phase.mode}
            deliveryMode={deliveryMode}
            canSend={canSend}
            onOpen={onOpen}
            onSelect={onSelect}
            onSend={onSend}
          />
        ))}
      </ScrollView>
    </View>
  );
}

function RoutingScopeOption({
  name,
  scope,
  dispatch,
}: {
  name: string;
  scope: string;
  dispatch: Dispatch<RoutingAction>;
}) {
  const selectScope = useCallback(() => dispatch({ type: "scope", scope }), [dispatch, scope]);
  return <DropdownMenuItem onSelect={selectScope}>{name}</DropdownMenuItem>;
}
function PickerRecipientRow({
  recipient,
  onSelect,
}: {
  recipient: Recipient;
  onSelect: (recipient: Recipient) => void;
}) {
  const { t } = useTranslation();
  const selectRecipient = useCallback(() => onSelect(recipient), [onSelect, recipient]);
  const name = `${recipient.projectName} · ${recipient.title} · ${recipient.hostLabel}`;
  return (
    <Button
      size="sm"
      variant="ghost"
      onPress={selectRecipient}
      style={styles.boundedButton}
      textStyle={styles.boundedButtonText}
      accessibilityLabel={t("sidebar.routing.useNamedChat", { name })}
    >
      {name}
    </Button>
  );
}
function formatMatchTimestamp(value: string): string {
  return new Date(value).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

function RoutingResult({
  recipient,
  mode,
  deliveryMode,
  canSend,
  onOpen,
  onSelect,
  onSend,
}: {
  recipient: Recipient;
  mode: "find" | "send";
  deliveryMode: RoutingState["deliveryMode"];
  canSend: boolean;
  onOpen: (recipient: Recipient) => void;
  onSelect: (recipient: Recipient) => void;
  onSend: (recipient: Recipient) => void;
}) {
  const { t } = useTranslation();
  const open = useCallback(() => onOpen(recipient), [onOpen, recipient]);
  const choose = useCallback(() => {
    if (mode === "find") onSelect(recipient);
    else onSend(recipient);
  }, [mode, onSelect, onSend, recipient]);
  return (
    <View style={styles.result}>
      <Text style={styles.title}>{recipient.title}</Text>
      <Text style={styles.muted}>
        {recipient.projectName} · {recipient.hostLabel}
      </Text>
      {recipient.updatedAt ? (
        <Text style={styles.muted}>Updated {formatMatchTimestamp(recipient.updatedAt)}</Text>
      ) : null}
      {recipient.excerptSource && recipient.excerptSource !== "title" ? (
        <Text style={styles.muted}>
          {recipient.excerptSource === "queued_message" ? "Queued message" : "Message"}
          {recipient.excerptTimestamp
            ? ` · ${formatMatchTimestamp(recipient.excerptTimestamp)}`
            : ""}
        </Text>
      ) : null}
      <Text numberOfLines={3} style={styles.muted}>
        {recipient.excerpt}
      </Text>
      <View style={styles.row}>
        <Button size="xs" variant="ghost" onPress={open}>
          {t("sidebar.routing.openChat")}
        </Button>
        <Button size="xs" variant="outline" onPress={choose} disabled={mode === "send" && !canSend}>
          {t(mode === "find" ? "sidebar.routing.useChat" : `sidebar.routing.${deliveryMode}Here`)}
        </Button>
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[2],
    gap: theme.spacing[2],
  },
  row: { flexDirection: "row", alignItems: "center", gap: theme.spacing[1], flexWrap: "wrap" },
  boundedButton: { maxWidth: "100%" },
  boundedButtonText: { flexShrink: 1 },
  input: {
    color: theme.colors.foreground,
    backgroundColor: theme.colors.surface1,
    borderColor: theme.colors.border,
    borderWidth: 1,
    borderRadius: theme.borderRadius.md,
    padding: theme.spacing[2],
    minHeight: 56,
    maxHeight: 140,
    fontSize: theme.fontSize.sm,
  },
  hint: { flex: 1, color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  muted: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  title: { color: theme.colors.foreground, fontSize: theme.fontSize.sm },
  receipt: { color: theme.colors.accent, fontSize: theme.fontSize.sm },
  results: { gap: theme.spacing[2] },
  resultScroll: { maxHeight: 260 },
  result: {
    gap: theme.spacing[1],
    paddingVertical: theme.spacing[2],
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
}));

function routingSubmitLabel(state: RoutingState) {
  return state.mode === "find" ? "sidebar.routing.findAction" : submitButtonLabel(state);
}

function RoutingDestinationControls({
  state,
  locked,
  togglePicker,
  selectNewConversation,
  dispatch,
  hosts,
  workspaces,
  serverIds,
}: {
  state: RoutingState;
  locked: boolean;
  togglePicker: () => void;
  selectNewConversation: () => void;
  dispatch: Dispatch<RoutingAction>;
  hosts: readonly { serverId: string; label?: string }[];
  workspaces: readonly import("./new-conversation").NewConversationCandidate[];
  serverIds: readonly string[];
}) {
  const { t } = useTranslation();
  let recipientName = t("sidebar.routing.automatic");
  if (state.recipient) recipientName = `${state.recipient.projectName} · ${state.recipient.title}`;
  if (state.newConversation) recipientName = t("sidebar.routing.newConversation");
  return (
    <>
      <View style={styles.row}>
        <Button
          size="xs"
          variant="ghost"
          disabled={locked}
          testID="routing-recipient"
          style={styles.boundedButton}
          textStyle={styles.boundedButtonText}
          onPress={togglePicker}
        >
          {t("sidebar.routing.to", {
            name: recipientName,
          })}
        </Button>
        <Button
          size="xs"
          variant={state.newConversation ? "secondary" : "outline"}
          disabled={locked}
          onPress={selectNewConversation}
          testID="routing-new-conversation"
        >
          {t("sidebar.routing.newConversation")}
        </Button>
      </View>
      {state.newConversation ? (
        <DropdownMenu compactMode="sheet">
          <DropdownMenuTrigger
            disabled={locked}
            accessibilityRole="button"
            accessibilityLabel={t("sidebar.routing.workspace")}
            testID="routing-new-workspace"
          >
            <Text style={styles.muted}>
              {state.newWorkspace
                ? `${state.newWorkspace.projectName} · ${state.newWorkspace.name} · ${hosts.find((host) => host.serverId === state.newWorkspace?.serverId)?.label ?? state.newWorkspace.serverId}`
                : t("sidebar.routing.chooseWorkspace")}
            </Text>
          </DropdownMenuTrigger>
          <DropdownMenuContent sheetTitle={t("sidebar.routing.chooseWorkspace")}>
            {workspaces
              .filter(
                (workspace) =>
                  serverIds.includes(workspace.serverId) &&
                  (state.scope === null || workspace.projectViewKey === state.scope),
              )
              .map((workspace) => (
                <RoutingWorkspaceOption
                  key={JSON.stringify([workspace.serverId, workspace.workspaceId])}
                  workspace={workspace}
                  dispatch={dispatch}
                  hostLabel={
                    hosts.find((host) => host.serverId === workspace.serverId)?.label ??
                    workspace.serverId
                  }
                />
              ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
      {!state.newConversation ? (
        <View style={styles.row} testID="routing-delivery-mode">
          {(["queue", "steer", "interrupt"] as const).map((mode) => (
            <RoutingDeliveryOption
              key={mode}
              mode={mode}
              selected={state.deliveryMode === mode}
              disabled={locked}
              dispatch={dispatch}
            />
          ))}
        </View>
      ) : null}
    </>
  );
}
function RoutingWorkspaceOption({
  workspace,
  dispatch,
  hostLabel,
}: {
  workspace: import("./model").NewConversationWorkspace;
  dispatch: Dispatch<RoutingAction>;
  hostLabel: string;
}) {
  const select = useCallback(
    () => dispatch({ type: "newWorkspace", workspace }),
    [dispatch, workspace],
  );
  return (
    <DropdownMenuItem
      onSelect={select}
    >{`${workspace.projectName} · ${workspace.name} · ${hostLabel}`}</DropdownMenuItem>
  );
}
function RoutingDeliveryOption({
  mode,
  selected,
  disabled,
  dispatch,
}: {
  mode: RoutingState["deliveryMode"];
  selected: boolean;
  disabled: boolean;
  dispatch: Dispatch<RoutingAction>;
}) {
  const { t } = useTranslation();
  const accessibilityState = useMemo(() => ({ selected }), [selected]);
  const select = useCallback(() => dispatch({ type: "deliveryMode", mode }), [dispatch, mode]);
  return (
    <Button
      size="xs"
      variant={selected ? "secondary" : "ghost"}
      disabled={disabled}
      accessibilityState={accessibilityState}
      aria-pressed={selected}
      onPress={select}
      testID={`routing-delivery-${mode}`}
    >
      {t(`sidebar.routing.${mode}`)}
    </Button>
  );
}
function submitButtonLabel(state: RoutingState) {
  if (state.mode === "find") return "sidebar.routing.find";
  if (state.newConversation) return "sidebar.routing.continueNewConversation";
  if (!state.recipient) return "sidebar.routing.findFirst";
  return `sidebar.routing.${state.deliveryMode}` as const;
}

async function sendDirectFromComposer({
  recipient,
  text,
  mode,
  itemId,
  draftVersion,
  draftUpdatedAt,
  getCurrent,
  dispatch,
}: {
  recipient: Recipient;
  text: string;
  mode: "steer" | "interrupt";
  itemId: string;
  draftVersion: number;
  draftUpdatedAt: number;
  getCurrent: () => { serverIds: readonly string[]; state: RoutingState };
  dispatch: Dispatch<RoutingAction>;
}) {
  try {
    const client = getHostRuntimeStore().getClient(recipient.serverId);
    if (!client) throw new Error("The host is offline. Your message is preserved.");
    await deliverDirectRoutedPrompt({
      recipient,
      text,
      mode,
      client,
      submission: createMessageSubmissionWriter(recipient.serverId),
      isHostEligible: () =>
        getCurrent().serverIds.includes(recipient.serverId) &&
        client.getConnectionState().status === "connected",
      isDestinationCurrent: () => {
        const session = useSessionStore.getState().sessions[recipient.serverId];
        const agent = session?.agents.get(recipient.agentId);
        const workspace = session?.workspaces.get(recipient.workspaceId);
        return Boolean(
          session?.hasHydratedWorkspaces &&
          agent &&
          !agent.archivedAt &&
          agent.workspaceId === recipient.workspaceId &&
          workspace?.projectId === recipient.projectId &&
          recipientInScope(recipient, getCurrent().state.scope),
        );
      },
      supportsSteerOnly: () => client.getLastServerInfoMessage()?.features?.steerOnly === true,
      getTurn: () =>
        selectAgentTurnPresentation(
          useSessionStore.getState().sessions[recipient.serverId],
          recipient.agentId,
        ),
    });
    dispatch({ type: "acknowledged", itemId, queued: false });
    // A successful send is final even when local draft cleanup cannot persist.
    // Keeping the receipt avoids offering a delivery retry after acceptance.
    try {
      const draft = useDraftStore.getState().drafts[ROUTING_DRAFT_KEY];
      if ((draft?.version ?? 0) === draftVersion && (draft?.updatedAt ?? 0) === draftUpdatedAt) {
        useDraftStore
          .getState()
          .clearDraftInput({ draftKey: ROUTING_DRAFT_KEY, lifecycle: "sent" });
        await flushDraftPersistStorageDurably();
      }
    } catch {
      dispatch({
        type: "receiptWarning",
        message:
          "Sent, but the saved draft could not be cleared. Check the destination before sending a restored draft again.",
      });
    }
  } catch (error) {
    dispatch({
      type: "phase",
      phase: {
        status: "error",
        message:
          error instanceof Error
            ? error.message
            : "Delivery could not be confirmed. Check the destination chat before sending again.",
      },
    });
  }
}

function canSendRoutedPrompt(
  state: RoutingState,
  serverIds: readonly string[],
  recipient: Recipient,
  retry: boolean,
) {
  if (!serverIds.includes(recipient.serverId)) return false;
  if (retry) return true;
  return recipientInScope(recipient, state.scope) && !isRoutingLocked(state);
}
function isSubmitDisabled(
  state: RoutingState,
  searchQuery: string,
  locked: boolean,
  workspaceEligible: boolean,
) {
  if (locked) return true;
  if (!(state.mode === "find" ? searchQuery : state.sendDraft).trim()) return true;
  return state.mode === "send" && state.newConversation && !workspaceEligible;
}
