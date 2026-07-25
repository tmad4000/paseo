import type { AgentNotebookPage } from "@getpaseo/client/internal/daemon-client";
import {
  WorkNotebookConflictError,
  WorkNotebookRpcError,
} from "@getpaseo/client/internal/daemon-client";
import type { NotebookAppendEntry, NotebookEvent } from "@getpaseo/protocol/notebook/types";
import { projectNotebookEvents } from "@getpaseo/protocol/notebook/projections";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { TFunction } from "i18next";
import {
  Check,
  CircleHelp,
  FileCode2,
  Link2,
  NotebookPen,
  Pin,
  PinOff,
  RotateCcw,
  StickyNote,
} from "lucide-react-native";
import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { FlatList, Text, TextInput, View, type ListRenderItemInfo } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import invariant from "tiny-invariant";
import { Button } from "@/components/ui/button";
import { ExternalLink } from "@/components/ui/external-link";
import { MarkdownRenderer } from "@/components/markdown/renderer";
import { useRetainedPanelActive } from "@/components/retained-panel";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { useFetchQuery } from "@/data/query";
import { usePaneContext } from "@/panels/pane-context";
import type { PanelDescriptor, PanelRegistration } from "@/panels/panel-registry";
import { useHostFeature } from "@/runtime/host-features";
import {
  useHostRuntimeClient,
  useHostRuntimeConnectionStatus,
  useHostRuntimeIsConnected,
} from "@/runtime/host-runtime";
import { useSessionStore } from "@/stores/session-store";
import { CompleteNotebookReadError, readCompleteNotebook } from "./read-complete-notebook";

type ComposerKind = "note_added" | "question_opened";

interface NotebookMutationInput {
  entry: NotebookAppendEntry;
}

type NotebookPanelErrorCode = "host_unavailable" | "load_before_write" | "incomplete_stream";

class NotebookPanelError extends Error {
  constructor(readonly code: NotebookPanelErrorCode) {
    super(code);
    this.name = "NotebookPanelError";
  }
}

function notebookQueryKey(serverId: string, agentId: string) {
  return ["agent-work-notebook", serverId, agentId] as const;
}

function useNotebookPanelDescriptor(
  target: { kind: "notebook"; agentId: string },
  context: { serverId: string },
): PanelDescriptor {
  const { t } = useTranslation();
  const agentTitle = useSessionStore((state) => {
    const session = state.sessions[context.serverId];
    const agent =
      session?.agents.get(target.agentId) ?? session?.agentDetails.get(target.agentId) ?? null;
    return agent?.title?.trim() || null;
  });
  return {
    label: t("workNotebook.title"),
    subtitle: agentTitle
      ? t("workNotebook.descriptor.sessionWithTitle", { title: agentTitle })
      : t("workNotebook.descriptor.session"),
    tooltip: agentTitle
      ? t("workNotebook.descriptor.tooltipWithTitle", { title: agentTitle })
      : t("workNotebook.descriptor.tooltip"),
    titleState: "ready",
    icon: NotebookPen,
    statusBucket: null,
  };
}

function NotebookPanel() {
  const { t } = useTranslation();
  const { serverId, target, openFileInWorkspace } = usePaneContext();
  invariant(target.kind === "notebook", "NotebookPanel requires notebook target");
  const isPanelActive = useRetainedPanelActive();
  const client = useHostRuntimeClient(serverId);
  const isConnected = useHostRuntimeIsConnected(serverId);
  const connectionStatus = useHostRuntimeConnectionStatus(serverId);
  const isSupported = useHostFeature(serverId, "workNotebook");
  const queryClient = useQueryClient();
  const queryKey = useMemo(
    () => notebookQueryKey(serverId, target.agentId),
    [serverId, target.agentId],
  );
  const [composerKind, setComposerKind] = useState<ComposerKind>("note_added");
  const [draft, setDraft] = useState("");
  const [writeStatus, setWriteStatus] = useState<string | null>(null);
  const [writeError, setWriteError] = useState<string | null>(null);

  const query = useFetchQuery({
    queryKey,
    dataShape: "value",
    staleTimeMs: 2_000,
    enabled: isPanelActive && isSupported && isConnected && Boolean(client),
    queryFn: async () => {
      if (!client) {
        throw new NotebookPanelError("host_unavailable");
      }
      return readCompleteNotebook(client, target.agentId);
    },
  });
  const refetchNotebook = query.refetch;
  const handleRefresh = useCallback(() => {
    void refetchNotebook();
  }, [refetchNotebook]);

  const mutation = useMutation({
    mutationFn: async ({ entry }: NotebookMutationInput) => {
      if (!client) {
        throw new NotebookPanelError("host_unavailable");
      }
      const current = queryClient.getQueryData<AgentNotebookPage>(queryKey);
      if (!current) {
        throw new NotebookPanelError("load_before_write");
      }
      if (current.hasMore || current.events.length !== current.notebook.lastSequence) {
        throw new NotebookPanelError("incomplete_stream");
      }
      if (!current.writable) {
        throw new WorkNotebookRpcError("agent_archived", "agent_archived");
      }
      return client.appendAgentNotebookEntry({
        agentId: target.agentId,
        expectedRevision: current.notebook.revision,
        entry,
      });
    },
    onMutate: () => {
      setWriteStatus(null);
      setWriteError(null);
    },
    onSuccess: (result, { entry }) => {
      queryClient.setQueryData<AgentNotebookPage>(queryKey, (current) =>
        current
          ? {
              ...current,
              notebook: result.notebook,
              events: [...current.events, result.event],
            }
          : current,
      );
      if (entry.kind === "note_added" || entry.kind === "question_opened") {
        setDraft((current) => (current.trim() === entry.markdown ? "" : current));
        setWriteStatus(
          entry.kind === "question_opened"
            ? t("workNotebook.status.questionAdded")
            : t("workNotebook.status.noteAdded"),
        );
      } else {
        setWriteStatus(t("workNotebook.status.updated"));
      }
    },
    onError: (error: unknown) => {
      if (error instanceof WorkNotebookConflictError) {
        setWriteError(t("workNotebook.errors.conflict"));
        void queryClient.invalidateQueries({ queryKey });
        return;
      }
      setWriteError(notebookErrorMessage(error, t));
    },
  });

  const appendEntry = useCallback(
    (entry: NotebookAppendEntry) => mutation.mutate({ entry }),
    [mutation],
  );
  const handleDraftChange = useCallback((nextDraft: string) => {
    setDraft(nextDraft);
    setWriteStatus(null);
    setWriteError(null);
  }, []);
  const handleSubmit = useCallback(() => {
    const markdown = draft.trim();
    if (!markdown) {
      return;
    }
    appendEntry({ kind: composerKind, markdown });
  }, [appendEntry, composerKind, draft]);
  const handleOpenArtifact = useCallback(
    (path: string) => {
      openFileInWorkspace({ location: { path }, disposition: "side" });
    },
    [openFileInWorkspace],
  );

  if (!isSupported) {
    return (
      <NotebookUnavailable
        title={t("workNotebook.unavailable.updateHostTitle")}
        description={t("workNotebook.unavailable.updateHostDescription")}
      />
    );
  }

  if (!isConnected && !query.data) {
    const description =
      connectionStatus === "connecting"
        ? t("workNotebook.unavailable.connecting")
        : t("workNotebook.unavailable.reconnect");
    return (
      <NotebookUnavailable title={t("workNotebook.unavailable.title")} description={description} />
    );
  }

  if (query.isPending && !query.data) {
    return (
      <View style={styles.centerState} testID="work-notebook-loading">
        <Text style={styles.stateEyebrow}>{t("workNotebook.eyebrow")}</Text>
        <Text style={styles.stateText}>{t("workNotebook.loading")}</Text>
      </View>
    );
  }

  if (query.error && !query.data) {
    return (
      <View style={styles.centerState} testID="work-notebook-load-error">
        <Text style={styles.stateEyebrow}>{t("workNotebook.eyebrow")}</Text>
        <Text style={styles.stateTitle}>{t("workNotebook.errors.loadTitle")}</Text>
        <Text style={styles.stateText}>{notebookErrorMessage(query.error, t)}</Text>
        <Button size="sm" variant="outline" onPress={handleRefresh}>
          {t("common.actions.retry")}
        </Button>
      </View>
    );
  }

  const page = query.data;
  if (!page) {
    return null;
  }
  if (page.hasMore || page.events.length !== page.notebook.lastSequence) {
    return (
      <View style={styles.centerState} testID="work-notebook-incomplete">
        <Text style={styles.stateEyebrow}>{t("workNotebook.eyebrow")}</Text>
        <Text style={styles.stateTitle}>{t("workNotebook.errors.incompleteTitle")}</Text>
        <Text style={styles.stateText}>{t("workNotebook.errors.incompleteStream")}</Text>
        <Button size="sm" variant="outline" onPress={handleRefresh}>
          {t("common.actions.retry")}
        </Button>
      </View>
    );
  }

  return (
    <NotebookReady
      page={page}
      isConnected={isConnected}
      isPending={mutation.isPending}
      composerKind={composerKind}
      draft={draft}
      writeStatus={writeStatus}
      writeError={writeError}
      onComposerKindChange={setComposerKind}
      onDraftChange={handleDraftChange}
      onSubmit={handleSubmit}
      onAppendEntry={appendEntry}
      onOpenArtifact={handleOpenArtifact}
      onRefresh={handleRefresh}
    />
  );
}

function NotebookUnavailable({ title, description }: { title: string; description: string }) {
  return (
    <View style={styles.centerState} testID="work-notebook-unavailable">
      <NotebookPen size={24} color={styles.mutedIcon.color} />
      <Text style={styles.stateTitle}>{title}</Text>
      <Text style={styles.stateText}>{description}</Text>
    </View>
  );
}

function NotebookReady({
  page,
  isConnected,
  isPending,
  composerKind,
  draft,
  writeStatus,
  writeError,
  onComposerKindChange,
  onDraftChange,
  onSubmit,
  onAppendEntry,
  onOpenArtifact,
  onRefresh,
}: {
  page: AgentNotebookPage;
  isConnected: boolean;
  isPending: boolean;
  composerKind: ComposerKind;
  draft: string;
  writeStatus: string | null;
  writeError: string | null;
  onComposerKindChange: (kind: ComposerKind) => void;
  onDraftChange: (draft: string) => void;
  onSubmit: () => void;
  onAppendEntry: (entry: NotebookAppendEntry) => void;
  onOpenArtifact: (path: string) => void;
  onRefresh: () => void;
}) {
  const { t } = useTranslation();
  const canWrite = isConnected && page.writable && !isPending;
  const composerOptions = useMemo(
    () => [
      {
        value: "note_added" as const,
        label: t("workNotebook.composer.note"),
        icon: ({ color, size }: { color: string; size: number }) => (
          <StickyNote color={color} size={size} />
        ),
        disabled: !page.writable,
        testID: "work-notebook-kind-note",
      },
      {
        value: "question_opened" as const,
        label: t("workNotebook.composer.question"),
        icon: ({ color, size }: { color: string; size: number }) => (
          <CircleHelp color={color} size={size} />
        ),
        disabled: !page.writable,
        testID: "work-notebook-kind-question",
      },
    ],
    [page.writable, t],
  );
  const projections = useMemo(() => projectNotebookEvents(page.events), [page.events]);
  const openQuestionIds = useMemo(
    () => new Set(projections.openQuestions.map((question) => question.id)),
    [projections.openQuestions],
  );
  const pinnedItemIds = useMemo(
    () => new Set(projections.pinnedItems.map((item) => item.id)),
    [projections.pinnedItems],
  );
  const eventById = useMemo(
    () => new Map(page.events.map((event) => [event.id, event])),
    [page.events],
  );
  const handleUnpin = useCallback(
    (event: NotebookEvent) => onAppendEntry({ kind: "item_unpinned", targetEventId: event.id }),
    [onAppendEntry],
  );
  const handleResolve = useCallback(
    (event: NotebookEvent) => onAppendEntry({ kind: "question_resolved", targetEventId: event.id }),
    [onAppendEntry],
  );
  const renderEvent = useCallback(
    ({ item }: ListRenderItemInfo<NotebookEvent>) => (
      <NotebookStreamRow
        event={item}
        targetEvent={"targetEventId" in item ? (eventById.get(item.targetEventId) ?? null) : null}
        isOpenQuestion={openQuestionIds.has(item.id)}
        isPinned={pinnedItemIds.has(item.id)}
        canWrite={canWrite}
        onAppendEntry={onAppendEntry}
        onOpenArtifact={onOpenArtifact}
      />
    ),
    [canWrite, eventById, onAppendEntry, onOpenArtifact, openQuestionIds, pinnedItemIds],
  );
  const listHeader = useMemo(
    () => (
      <NotebookListHeader
        page={page}
        isConnected={isConnected}
        canWrite={canWrite}
        pinnedItems={projections.pinnedItems}
        openQuestions={projections.openQuestions}
        onRefresh={onRefresh}
        onUnpin={handleUnpin}
        onResolve={handleResolve}
      />
    ),
    [
      handleResolve,
      handleUnpin,
      isConnected,
      canWrite,
      onRefresh,
      page,
      projections.openQuestions,
      projections.pinnedItems,
    ],
  );

  return (
    <View style={styles.root} testID="work-notebook-panel">
      <FlatList
        data={page.events}
        renderItem={renderEvent}
        keyExtractor={notebookEventKey}
        contentContainerStyle={styles.listContent}
        ListHeaderComponent={listHeader}
      />

      <View style={styles.composer} testID="work-notebook-composer">
        <SegmentedControl
          value={composerKind}
          onValueChange={onComposerKindChange}
          size="xs"
          options={composerOptions}
        />
        <View style={styles.composerInputRow}>
          <TextInput
            value={draft}
            onChangeText={onDraftChange}
            editable={canWrite}
            multiline
            placeholder={
              composerKind === "question_opened"
                ? t("workNotebook.composer.questionPlaceholder")
                : t("workNotebook.composer.notePlaceholder")
            }
            placeholderTextColor={styles.placeholder.color}
            style={styles.composerInput}
            accessibilityLabel={
              composerKind === "question_opened"
                ? t("workNotebook.composer.questionAccessibility")
                : t("workNotebook.composer.noteAccessibility")
            }
            testID="work-notebook-input"
          />
          <Button
            variant="default"
            size="sm"
            onPress={onSubmit}
            loading={isPending}
            disabled={!canWrite || !draft.trim()}
            testID="work-notebook-submit"
          >
            {t("workNotebook.composer.add")}
          </Button>
        </View>
        {writeError ? (
          <Text style={styles.composerError} accessibilityRole="alert">
            {writeError}
          </Text>
        ) : null}
        {!writeError && writeStatus ? (
          <Text style={styles.composerStatus}>{writeStatus}</Text>
        ) : null}
      </View>
    </View>
  );
}

function NotebookListHeader({
  page,
  isConnected,
  canWrite,
  pinnedItems,
  openQuestions,
  onRefresh,
  onUnpin,
  onResolve,
}: {
  page: AgentNotebookPage;
  isConnected: boolean;
  canWrite: boolean;
  pinnedItems: NotebookEvent[];
  openQuestions: NotebookEvent[];
  onRefresh: () => void;
  onUnpin: (event: NotebookEvent) => void;
  onResolve: (event: NotebookEvent) => void;
}) {
  const { t } = useTranslation();
  return (
    <View style={styles.listHeader}>
      <View style={styles.introRow}>
        <View style={styles.introCopy}>
          <Text style={styles.sectionEyebrow}>{t("workNotebook.eyebrow")}</Text>
          <Text style={styles.introText}>{t("workNotebook.intro")}</Text>
        </View>
        <Button size="xs" variant="ghost" onPress={onRefresh} disabled={!isConnected}>
          {t("workNotebook.refresh")}
        </Button>
      </View>

      {!isConnected ? (
        <View style={styles.inlineNotice}>
          <Text style={styles.inlineNoticeText}>{t("workNotebook.notices.reconnecting")}</Text>
        </View>
      ) : null}

      {page.readOnlyReason === "agent_archived" ? (
        <View style={styles.inlineNotice} testID="work-notebook-read-only">
          <Text style={styles.inlineNoticeText}>{t("workNotebook.notices.archivedReadOnly")}</Text>
        </View>
      ) : null}

      <NotebookLens
        title={t("workNotebook.sections.pinned")}
        emptyText={t("workNotebook.empty.pinned")}
        events={pinnedItems}
        canWrite={canWrite}
        actionLabel={t("workNotebook.actions.unpin")}
        actionIcon={PinOff}
        onAction={onUnpin}
      />
      <NotebookLens
        title={t("workNotebook.sections.openQuestions")}
        emptyText={t("workNotebook.empty.openQuestions")}
        events={openQuestions}
        canWrite={canWrite}
        actionLabel={t("workNotebook.actions.resolve")}
        actionIcon={Check}
        onAction={onResolve}
      />

      <View style={styles.streamHeader}>
        <Text style={styles.sectionEyebrow}>{t("workNotebook.sections.stream")}</Text>
        <Text style={styles.streamCount}>
          {t("workNotebook.eventCount", { count: page.events.length })}
        </Text>
      </View>
      {page.events.length === 0 ? (
        <View style={styles.emptyStream}>
          <StickyNote size={18} color={styles.mutedIcon.color} />
          <Text style={styles.emptyStreamTitle}>{t("workNotebook.empty.streamTitle")}</Text>
          <Text style={styles.emptyStreamText}>{t("workNotebook.empty.streamDescription")}</Text>
        </View>
      ) : null}
    </View>
  );
}

function NotebookLens({
  title,
  emptyText,
  events,
  canWrite,
  actionLabel,
  actionIcon,
  onAction,
}: {
  title: string;
  emptyText: string;
  events: NotebookEvent[];
  canWrite: boolean;
  actionLabel: string;
  actionIcon: typeof Check;
  onAction: (event: NotebookEvent) => void;
}) {
  return (
    <View style={styles.lens}>
      <View style={styles.lensHeader}>
        <Text style={styles.sectionEyebrow}>{title.toUpperCase()}</Text>
        {events.length > 0 ? <Text style={styles.lensCount}>{events.length}</Text> : null}
      </View>
      {events.length === 0 ? (
        <Text style={styles.lensEmpty}>{emptyText}</Text>
      ) : (
        <View style={styles.lensItems}>
          {events.map((event) => (
            <NotebookLensItem
              key={event.id}
              event={event}
              canWrite={canWrite}
              actionLabel={actionLabel}
              actionIcon={actionIcon}
              onAction={onAction}
            />
          ))}
        </View>
      )}
    </View>
  );
}

function NotebookLensItem({
  event,
  canWrite,
  actionLabel,
  actionIcon,
  onAction,
}: {
  event: NotebookEvent;
  canWrite: boolean;
  actionLabel: string;
  actionIcon: typeof Check;
  onAction: (event: NotebookEvent) => void;
}) {
  const { t } = useTranslation();
  const handleAction = useCallback(() => onAction(event), [event, onAction]);
  return (
    <View style={styles.lensItem}>
      <View style={styles.lensCopy}>
        <MarkdownRenderer text={eventText(event, t)} compact />
      </View>
      <Button
        size="xs"
        variant="ghost"
        leftIcon={actionIcon}
        disabled={!canWrite}
        onPress={handleAction}
      >
        {actionLabel}
      </Button>
    </View>
  );
}

function NotebookStreamRow({
  event,
  targetEvent,
  isOpenQuestion,
  isPinned,
  canWrite,
  onAppendEntry,
  onOpenArtifact,
}: {
  event: NotebookEvent;
  targetEvent: NotebookEvent | null;
  isOpenQuestion: boolean;
  isPinned: boolean;
  canWrite: boolean;
  onAppendEntry: (entry: NotebookAppendEntry) => void;
  onOpenArtifact: (path: string) => void;
}) {
  const { t } = useTranslation();
  const isMarkdownEvent = event.kind === "note_added" || event.kind === "question_opened";
  const isPinnableEvent =
    isMarkdownEvent || event.kind === "link_captured" || event.kind === "artifact_observed";
  const isQuestion = event.kind === "question_opened";
  const handlePinToggle = useCallback(() => {
    onAppendEntry({
      kind: isPinned ? "item_unpinned" : "item_pinned",
      targetEventId: event.id,
    });
  }, [event.id, isPinned, onAppendEntry]);
  const handleQuestionToggle = useCallback(() => {
    onAppendEntry({
      kind: isOpenQuestion ? "question_resolved" : "question_reopened",
      targetEventId: event.id,
    });
  }, [event.id, isOpenQuestion, onAppendEntry]);
  const handleOpenArtifact = useCallback(() => {
    if (event.kind === "artifact_observed") {
      onOpenArtifact(event.artifact.path);
    }
  }, [event, onOpenArtifact]);

  return (
    <View style={styles.eventRow} testID={`work-notebook-event-${event.id}`}>
      <View style={styles.eventRail}>{renderNotebookEventIcon(event)}</View>
      <View style={styles.eventBody}>
        <View style={styles.eventMetaRow}>
          <Text style={styles.eventKind}>{eventLabel(event, t)}</Text>
          <Text style={styles.eventMeta}>
            {authorLabel(event, t)} · {formatNotebookTime(event.createdAt)}
          </Text>
        </View>
        <NotebookStreamEventContent
          event={event}
          targetEvent={targetEvent}
          onOpenArtifact={handleOpenArtifact}
        />
        {isPinnableEvent ? (
          <View style={styles.eventActions}>
            <Button
              size="xs"
              variant="ghost"
              leftIcon={isPinned ? PinOff : Pin}
              disabled={!canWrite}
              onPress={handlePinToggle}
            >
              {isPinned ? t("workNotebook.actions.unpin") : t("workNotebook.actions.pin")}
            </Button>
            {isQuestion ? (
              <Button
                size="xs"
                variant="ghost"
                leftIcon={isOpenQuestion ? Check : RotateCcw}
                disabled={!canWrite}
                onPress={handleQuestionToggle}
              >
                {isOpenQuestion
                  ? t("workNotebook.actions.resolve")
                  : t("workNotebook.actions.reopen")}
              </Button>
            ) : null}
          </View>
        ) : null}
      </View>
    </View>
  );
}

function NotebookStreamEventContent({
  event,
  targetEvent,
  onOpenArtifact,
}: {
  event: NotebookEvent;
  targetEvent: NotebookEvent | null;
  onOpenArtifact: () => void;
}) {
  const { t } = useTranslation();
  if (event.kind === "note_added" || event.kind === "question_opened") {
    return <MarkdownRenderer text={event.markdown} compact />;
  }
  if (event.kind === "link_captured") {
    return (
      <ExternalLink
        href={event.url}
        label={event.url}
        accessibilityLabel={t("workNotebook.actions.openLink", { url: event.url })}
        testID={`work-notebook-link-${event.id}`}
      />
    );
  }
  if (event.kind === "artifact_observed") {
    return (
      <View style={styles.derivedArtifact}>
        <View style={styles.derivedArtifactCopy}>
          <Text style={styles.derivedArtifactName} numberOfLines={1}>
            {event.artifact.name}
          </Text>
          <Text style={styles.derivedArtifactPath} numberOfLines={1}>
            {event.artifact.path}
          </Text>
        </View>
        <Button size="xs" variant="ghost" onPress={onOpenArtifact}>
          {t("workNotebook.actions.openArtifact")}
        </Button>
      </View>
    );
  }
  return (
    <Text style={styles.eventActionText}>
      {targetEvent ? eventText(targetEvent, t) : t("workNotebook.events.referencedItem")}
    </Text>
  );
}

function notebookEventKey(event: NotebookEvent): string {
  return event.id;
}

function renderNotebookEventIcon(event: NotebookEvent) {
  if (event.kind === "question_opened") {
    return <CircleHelp size={15} color={styles.foregroundMutedIcon.color} />;
  }
  if (event.kind === "note_added") {
    return <StickyNote size={15} color={styles.foregroundMutedIcon.color} />;
  }
  if (event.kind === "link_captured") {
    return <Link2 size={15} color={styles.foregroundMutedIcon.color} />;
  }
  if (event.kind === "artifact_observed") {
    return <FileCode2 size={15} color={styles.foregroundMutedIcon.color} />;
  }
  if (event.kind === "item_pinned" || event.kind === "item_unpinned") {
    return <Pin size={15} color={styles.mutedIcon.color} />;
  }
  if (event.kind === "question_reopened") {
    return <RotateCcw size={15} color={styles.mutedIcon.color} />;
  }
  return <Check size={15} color={styles.mutedIcon.color} />;
}

function eventText(event: NotebookEvent, t: TFunction): string {
  if (event.kind === "note_added" || event.kind === "question_opened") {
    return event.markdown;
  }
  if (event.kind === "link_captured") {
    return event.url;
  }
  if (event.kind === "artifact_observed") {
    return event.artifact.name;
  }
  return eventLabel(event, t);
}

function eventLabel(event: NotebookEvent, t: TFunction): string {
  switch (event.kind) {
    case "note_added":
      return t("workNotebook.events.note");
    case "question_opened":
      return t("workNotebook.events.questionOpened");
    case "question_resolved":
      return t("workNotebook.events.questionResolved");
    case "question_reopened":
      return t("workNotebook.events.questionReopened");
    case "item_pinned":
      return t("workNotebook.events.itemPinned");
    case "item_unpinned":
      return t("workNotebook.events.itemUnpinned");
    case "link_captured":
      return t("workNotebook.events.linkCaptured");
    case "artifact_observed":
      return t("workNotebook.events.artifactObserved");
  }
}

function authorLabel(event: NotebookEvent, t: TFunction): string {
  switch (event.author.kind) {
    case "agent":
      return t("workNotebook.authors.agent");
    case "system":
      return t("workNotebook.authors.system");
    case "user":
      return t("workNotebook.authors.you");
  }
}

function notebookErrorMessage(error: unknown, t: TFunction): string {
  if (error instanceof CompleteNotebookReadError) {
    switch (error.code) {
      case "inconsistent_revision":
        return t("workNotebook.errors.inconsistentRevision");
      case "no_progress":
        return t("workNotebook.errors.noProgress");
      case "page_limit":
      case "invalid_sequence":
        return t("workNotebook.errors.incompleteStream");
      case "empty_response":
        return t("workNotebook.errors.unknown");
    }
  }
  if (error instanceof WorkNotebookRpcError) {
    switch (error.code) {
      case "agent_archived":
        return t("workNotebook.errors.archived");
      case "agent_not_found":
        return t("workNotebook.errors.agentNotFound");
      case "invalid_target":
        return t("workNotebook.errors.invalidTarget");
    }
  }
  if (error instanceof NotebookPanelError) {
    switch (error.code) {
      case "host_unavailable":
        return t("workNotebook.errors.hostUnavailable");
      case "load_before_write":
        return t("workNotebook.errors.loadBeforeWrite");
      case "incomplete_stream":
        return t("workNotebook.errors.incompleteStream");
    }
  }
  return t("workNotebook.errors.unknown");
}

function formatNotebookTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

const styles = StyleSheet.create((theme) => ({
  root: {
    flex: 1,
    minWidth: 0,
    backgroundColor: theme.colors.surface0,
  },
  listContent: {
    paddingHorizontal: theme.spacing[6],
    paddingTop: theme.spacing[6],
    paddingBottom: theme.spacing[8],
  },
  listHeader: {
    gap: theme.spacing[6],
  },
  introRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: theme.spacing[3],
  },
  introCopy: {
    flex: 1,
    minWidth: 0,
    gap: theme.spacing[2],
  },
  introText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    lineHeight: 20,
  },
  sectionEyebrow: {
    color: theme.colors.foregroundExtraMuted,
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.medium,
    letterSpacing: 0.7,
  },
  lens: {
    gap: theme.spacing[2],
  },
  lensHeader: {
    minHeight: 20,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  lensCount: {
    color: theme.colors.foregroundExtraMuted,
    fontSize: theme.fontSize.xs,
    fontVariant: ["tabular-nums"],
  },
  lensEmpty: {
    color: theme.colors.foregroundExtraMuted,
    fontSize: theme.fontSize.xs,
    paddingVertical: theme.spacing[2],
  },
  lensItems: {
    gap: theme.spacing[2],
  },
  lensItem: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: theme.spacing[2],
    paddingVertical: theme.spacing[3],
    paddingLeft: theme.spacing[4],
    paddingRight: theme.spacing[2],
    borderRadius: theme.borderRadius.lg,
    backgroundColor: theme.colors.surface1,
  },
  lensCopy: {
    flex: 1,
    minWidth: 0,
  },
  streamHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingTop: theme.spacing[2],
  },
  streamCount: {
    color: theme.colors.foregroundExtraMuted,
    fontSize: theme.fontSize.xs,
    fontVariant: ["tabular-nums"],
  },
  eventRow: {
    flexDirection: "row",
    gap: theme.spacing[3],
    paddingVertical: theme.spacing[4],
    borderBottomWidth: theme.borderWidth[1],
    borderBottomColor: theme.colors.borderAccent,
  },
  eventRail: {
    width: 18,
    paddingTop: 2,
    alignItems: "center",
  },
  eventBody: {
    flex: 1,
    minWidth: 0,
    gap: theme.spacing[2],
  },
  eventMetaRow: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: theme.spacing[3],
  },
  eventKind: {
    flexShrink: 1,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.medium,
  },
  eventMeta: {
    flexShrink: 0,
    color: theme.colors.foregroundExtraMuted,
    fontSize: theme.fontSize.xs,
  },
  eventActionText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    lineHeight: 20,
  },
  derivedArtifact: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  derivedArtifactCopy: {
    flex: 1,
    minWidth: 0,
    gap: theme.spacing[1],
  },
  derivedArtifactName: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
  derivedArtifactPath: {
    color: theme.colors.foregroundExtraMuted,
    fontSize: theme.fontSize.xs,
  },
  eventActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    marginLeft: -theme.spacing[2],
  },
  emptyStream: {
    alignItems: "center",
    paddingVertical: theme.spacing[8],
    paddingHorizontal: theme.spacing[6],
    gap: theme.spacing[2],
  },
  emptyStreamTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
  emptyStreamText: {
    maxWidth: 320,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
    lineHeight: 18,
    textAlign: "center",
  },
  composer: {
    paddingHorizontal: theme.spacing[4],
    paddingTop: theme.spacing[3],
    paddingBottom: theme.spacing[4],
    borderTopWidth: theme.borderWidth[1],
    borderTopColor: theme.colors.border,
    backgroundColor: theme.colors.surface0,
    gap: theme.spacing[2],
  },
  composerInputRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: theme.spacing[2],
  },
  composerInput: {
    flex: 1,
    minHeight: 40,
    maxHeight: 120,
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.lg,
    backgroundColor: theme.colors.surface1,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    lineHeight: 20,
    textAlignVertical: "top",
  },
  composerStatus: {
    color: theme.colors.success,
    fontSize: theme.fontSize.xs,
  },
  composerError: {
    color: theme.colors.destructive,
    fontSize: theme.fontSize.xs,
  },
  centerState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: theme.spacing[8],
    gap: theme.spacing[3],
    backgroundColor: theme.colors.surface0,
  },
  stateEyebrow: {
    color: theme.colors.foregroundExtraMuted,
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.medium,
    letterSpacing: 0.7,
  },
  stateTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
    textAlign: "center",
  },
  stateText: {
    maxWidth: 360,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    lineHeight: 20,
    textAlign: "center",
  },
  inlineNotice: {
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    borderLeftWidth: 2,
    borderLeftColor: theme.colors.border,
  },
  inlineNoticeText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
    lineHeight: 18,
  },
  placeholder: {
    color: theme.colors.foregroundExtraMuted,
  },
  mutedIcon: {
    color: theme.colors.foregroundExtraMuted,
  },
  foregroundMutedIcon: {
    color: theme.colors.foregroundMuted,
  },
}));

export const notebookPanelRegistration: PanelRegistration<"notebook"> = {
  kind: "notebook",
  component: NotebookPanel,
  useDescriptor: useNotebookPanelDescriptor,
};
