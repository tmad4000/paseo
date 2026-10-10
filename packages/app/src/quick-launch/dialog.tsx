import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { Text, View, type NativeSyntheticEvent, type TextInputKeyPressEventData } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { createNameId } from "mnemonic-id";
import { AdaptiveModalSheet, AdaptiveTextInput } from "@/components/adaptive-modal-sheet";
import { HostPicker } from "@/components/hosts/host-picker";
import { HostStatusDot } from "@/components/host-status-dot";
import { ProjectIconView } from "@/components/project-icon-view";
import { Button } from "@/components/ui/button";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { ComboboxTrigger } from "@/components/ui/combobox-trigger";
import { SegmentedControl, type SegmentedControlOption } from "@/components/ui/segmented-control";
import { Shortcut } from "@/components/ui/shortcut";
import type { EditingTextInputHandle } from "@/components/ui/text-input";
import { DraftAgentControls } from "@/composer/agent-controls";
import { useAgentInputDraft } from "@/composer/draft/input-draft";
import { useIsCompactFormFactor } from "@/constants/layout";
import { isWeb } from "@/constants/platform";
import { getHostProjectSourceDirectory, type HostProjectListItem } from "@/projects/host-projects";
import { useProjectIcons } from "@/projects/icons";
import { buildNewWorkspaceProjectIconTargets } from "@/screens/new-workspace/project-icon-targets";
import { generateDraftId, QUICK_LAUNCH_DRAFT_KEY } from "@/stores/draft-keys";
import type { HostProfile } from "@/types/host-connection";
import { projectIconPlaceholderLabelFromDisplayName } from "@/utils/project-display-name";
import {
  destinationOfTarget,
  type QuickLaunchWhere,
  type QuickLaunchWorkspaceRef,
} from "./destination";
import type { QuickLaunchSubmission } from "./launch";
import type { QuickLaunchRequest, QuickLaunchSession } from "./store";
import { useQuickLaunchDestination } from "./use-destination";

export interface QuickLaunchStartRequest {
  submission: QuickLaunchSubmission;
  openAfterStart: boolean;
  projectName: string;
  /** `null` when the agent starts in a new workspace. */
  workspaceName: string | null;
  /** Reopens the dialog on the same destination when the start fails. */
  retry: QuickLaunchRequest;
}

interface QuickLaunchDialogProps {
  visible: boolean;
  session: QuickLaunchSession;
  active: QuickLaunchWorkspaceRef | null;
  onClose: () => void;
  onDismiss: () => void;
  onStart: (request: QuickLaunchStartRequest) => void;
}

type WebKeyPressEvent = NativeSyntheticEvent<
  TextInputKeyPressEventData & { metaKey?: boolean; ctrlKey?: boolean; shiftKey?: boolean }
>;

const START_KEYS = ["mod", "Enter"];
const START_AND_OPEN_KEYS = ["mod", "shift", "Enter"];
const startShortcut = <Shortcut keys={START_KEYS} />;
const startAndOpenShortcut = <Shortcut keys={START_AND_OPEN_KEYS} />;
const PROJECT_ICON_FALLBACK_FONT_SIZE = 10;
const SNAP_POINTS = ["70%", "92%"];

/**
 * The Quick launch prompt is one draft-store draft, so it survives closing the dialog. A requested
 * prompt (Retry, or one handed over by another surface) replaces it once the store has loaded the
 * saved draft, so hydration cannot overwrite the handed-over text.
 */
function useQuickLaunchPrompt(input: {
  serverId: string;
  workingDir: string | undefined;
  visible: boolean;
  prompt: string | undefined;
}) {
  const composerOptions = useMemo(
    () => ({
      initialServerId: input.serverId || null,
      isVisible: input.visible,
      lockedWorkingDir: input.workingDir,
    }),
    [input.serverId, input.visible, input.workingDir],
  );
  const draft = useAgentInputDraft({ draftKey: QUICK_LAUNCH_DRAFT_KEY, composer: composerOptions });
  const text = useSyncExternalStore(
    draft.textSource.subscribe,
    draft.textSource.getSnapshot,
    draft.textSource.getSnapshot,
  );
  const appliedPromptRef = useRef(false);
  const { isHydrated, replaceText } = draft;
  const { prompt } = input;
  useEffect(() => {
    if (!isHydrated || appliedPromptRef.current || prompt === undefined) return;
    appliedPromptRef.current = true;
    replaceText(prompt);
  }, [isHydrated, prompt, replaceText]);
  return { draft, text };
}

export function QuickLaunchDialog({
  visible,
  session,
  active,
  onClose,
  onDismiss,
  onStart,
}: QuickLaunchDialogProps): ReactElement {
  const { t } = useTranslation();
  const isCompact = useIsCompactFormFactor();
  const { request } = session;
  const destination = useQuickLaunchDestination({ request, active });
  const { target, shownProject, tabWorkspace } = destination;
  const workingDir =
    target?.kind === "existing-workspace" ? target.workspaceDirectory : target?.sourceDirectory;
  const { draft, text } = useQuickLaunchPrompt({
    serverId: destination.serverId,
    workingDir,
    visible,
    prompt: request.prompt,
  });
  const composerState = draft.composerState;
  const inputRef = useRef<EditingTextInputHandle | null>(null);

  const projectIconTargets = useMemo(
    () => buildNewWorkspaceProjectIconTargets(destination.projects, destination.serverId),
    [destination.projects, destination.serverId],
  );
  const projectIcons = useProjectIcons({ projects: projectIconTargets });

  const clearDraft = draft.clear;
  const tabWorkspaceName = tabWorkspace?.name ?? null;
  const opensAfterStart = request.startAndOpen === true;
  const start = useCallback(
    (openAfterStart: boolean) => {
      const prompt = (inputRef.current?.getText() ?? text).trim();
      const provider = composerState?.selectedProvider;
      if (!prompt || !target || !shownProject || !composerState || !provider) return;
      void composerState.persistFormPreferences();
      onStart({
        submission: {
          launchId: generateDraftId(),
          worktreeSlug: createNameId(),
          target,
          text: prompt,
          provider,
          selection: {
            selectedMode: composerState.selectedMode,
            effectiveModelId: composerState.effectiveModelId,
            effectiveThinkingOptionId: composerState.effectiveThinkingOptionId,
            featureValues: composerState.featureValues,
          },
        },
        openAfterStart,
        projectName: shownProject.projectName,
        workspaceName: target.kind === "existing-workspace" ? tabWorkspaceName : null,
        retry: {
          prompt,
          destination: destinationOfTarget(target),
          ...(opensAfterStart ? { startAndOpen: true } : {}),
        },
      });
      clearDraft("sent");
    },
    [
      clearDraft,
      composerState,
      onStart,
      opensAfterStart,
      shownProject,
      tabWorkspaceName,
      target,
      text,
    ],
  );
  const startInBackground = useCallback(() => start(false), [start]);
  const startAndOpen = useCallback(() => start(true), [start]);

  const handleKeyPress = useCallback(
    (event: WebKeyPressEvent) => {
      const { key, metaKey, ctrlKey, shiftKey } = event.nativeEvent;
      if (key !== "Enter" || !(metaKey || ctrlKey)) return;
      event.preventDefault();
      start(shiftKey === true);
    },
    [start],
  );

  const header = useMemo(() => ({ title: t("quickLaunch.title") }), [t]);
  const canStart = Boolean(text.trim() && target && shownProject && composerState?.selectedProvider);
  const agentControls = composerState?.agentControls;
  const destinationLocked = destination.where === "existing-workspace";
  const shownIcon = shownProject ? (projectIcons.get(shownProject.viewKey) ?? null) : null;
  const footer = (
    <QuickLaunchFooter
      canStart={canStart}
      opensAfterStart={opensAfterStart}
      onStart={startInBackground}
      onStartAndOpen={startAndOpen}
    />
  );

  return (
    <AdaptiveModalSheet
      header={header}
      visible={visible}
      onClose={onClose}
      onDismiss={onDismiss}
      footer={footer}
      testID="quick-launch-dialog"
      desktopMaxWidth={640}
      snapPoints={SNAP_POINTS}
    >
      <AdaptiveTextInput
        ref={inputRef}
        initialValue={draft.textReplacement.text}
        resetKey={draft.textReplacement.key}
        onChangeText={draft.editText}
        onKeyPress={isWeb ? handleKeyPress : undefined}
        placeholder={t("quickLaunch.placeholder")}
        accessibilityLabel={t("quickLaunch.promptLabel")}
        multiline
        autoFocus
        style={styles.input}
        testID="quick-launch-prompt"
      />
      <View style={styles.destination}>
        <QuickLaunchProjectPicker
          projects={destination.projectsOnHost}
          project={shownProject}
          iconDataUri={shownIcon}
          disabled={destinationLocked}
          serverId={destination.projectServerId}
          onSelect={destination.selectProject}
        />
        {destination.hosts.length > 1 ? (
          <QuickLaunchHostPicker
            hosts={destination.hosts}
            serverId={destination.serverId}
            disabled={destinationLocked}
            onSelect={destination.selectHost}
          />
        ) : null}
      </View>
      <QuickLaunchWhereControl
        where={destination.where}
        tabWorkspaceName={tabWorkspaceName}
        onChange={destination.setWhere}
      />
      {agentControls ? (
        <View style={styles.agentControls} testID="quick-launch-agent-controls">
          <DraftAgentControls {...agentControls} isCompactLayout={isCompact} />
        </View>
      ) : null}
    </AdaptiveModalSheet>
  );
}

function QuickLaunchFooter({
  canStart,
  opensAfterStart,
  onStart,
  onStartAndOpen,
}: {
  canStart: boolean;
  /** The opener asked for Start and open, so it takes the accent. The shortcuts never move. */
  opensAfterStart: boolean;
  onStart: () => void;
  onStartAndOpen: () => void;
}) {
  const { t } = useTranslation();
  return (
    <>
      <View style={styles.footerSpacer} />
      <Button
        variant={opensAfterStart ? "default" : "secondary"}
        size="sm"
        onPress={onStartAndOpen}
        disabled={!canStart}
        trailing={startAndOpenShortcut}
        accessibilityHint={t("quickLaunch.actions.startAndOpenHint")}
        testID="quick-launch-start-and-open"
      >
        {t("quickLaunch.actions.startAndOpen")}
      </Button>
      <Button
        variant={opensAfterStart ? "secondary" : "default"}
        size="sm"
        onPress={onStart}
        disabled={!canStart}
        trailing={startShortcut}
        accessibilityHint={t("quickLaunch.actions.startHint")}
        testID="quick-launch-start"
      >
        {t("quickLaunch.actions.start")}
      </Button>
    </>
  );
}

function QuickLaunchWhereControl({
  where,
  tabWorkspaceName,
  onChange,
}: {
  where: QuickLaunchWhere;
  tabWorkspaceName: string | null;
  onChange: (where: QuickLaunchWhere) => void;
}) {
  const { t } = useTranslation();
  const options = useMemo<SegmentedControlOption<QuickLaunchWhere>[]>(() => {
    if (tabWorkspaceName === null) return [];
    return [
      {
        value: "new-workspace",
        label: t("quickLaunch.where.newWorkspace"),
        testID: "quick-launch-where-new-workspace",
      },
      {
        value: "existing-workspace",
        label: t("quickLaunch.where.newTab", { workspace: tabWorkspaceName }),
        testID: "quick-launch-where-existing-workspace",
      },
    ];
  }, [t, tabWorkspaceName]);
  if (options.length === 0) return null;
  return (
    <SegmentedControl
      options={options}
      value={where}
      onValueChange={onChange}
      size="xs"
      style={styles.where}
      segmentStyle={styles.whereSegment}
      testID="quick-launch-where"
    />
  );
}

function QuickLaunchProjectPicker({
  projects,
  project,
  iconDataUri,
  disabled,
  serverId,
  onSelect,
}: {
  projects: HostProjectListItem[];
  project: HostProjectListItem | null;
  iconDataUri: string | null;
  disabled: boolean;
  serverId: string;
  onSelect: (projectViewKey: string) => void;
}) {
  const { t } = useTranslation();
  const anchorRef = useRef<View>(null);
  const [open, setOpen] = useState(false);
  const options = useMemo<ComboboxOption[]>(
    () =>
      projects.map((project) => ({
        id: project.viewKey,
        label: project.projectName,
        description: getHostProjectSourceDirectory(project, serverId) ?? project.iconWorkingDir,
      })),
    [projects, serverId],
  );
  const openPicker = useCallback(() => setOpen(true), []);
  const select = useCallback(
    (id: string) => {
      onSelect(id);
      setOpen(false);
    },
    [onSelect],
  );
  const selectedProjectViewKey = project?.viewKey ?? null;
  const label = project?.projectName ?? t("quickLaunch.project.choose");
  const placeholderInitial =
    projectIconPlaceholderLabelFromDisplayName(label).charAt(0).toUpperCase() || "?";

  return (
    <View style={styles.control}>
      <ComboboxTrigger
        ref={anchorRef}
        onPress={openPicker}
        disabled={disabled}
        style={chipStyle}
        accessibilityRole="button"
        accessibilityLabel={t("quickLaunch.project.label", { project: label })}
        testID="quick-launch-project-trigger"
      >
        {selectedProjectViewKey ? (
          <View style={styles.chipIcon}>
            <ProjectIconView
              iconDataUri={iconDataUri}
              initial={placeholderInitial}
              projectViewKey={selectedProjectViewKey}
              size={16}
              textStyle={styles.projectIconFallbackText}
            />
          </View>
        ) : null}
        <Text style={styles.chipText} numberOfLines={1}>
          {label}
        </Text>
      </ComboboxTrigger>
      <Combobox
        options={options}
        value={selectedProjectViewKey ?? ""}
        onSelect={select}
        searchable
        searchPlaceholder={t("quickLaunch.project.search")}
        title={t("quickLaunch.project.title")}
        open={open}
        onOpenChange={setOpen}
        desktopPlacement="bottom-start"
        desktopMinWidth={360}
        anchorRef={anchorRef}
        emptyText={t("quickLaunch.project.empty")}
      />
    </View>
  );
}

function QuickLaunchHostPicker({
  hosts,
  serverId,
  disabled,
  onSelect,
}: {
  hosts: HostProfile[];
  serverId: string;
  disabled: boolean;
  onSelect: (serverId: string) => void;
}) {
  const { t } = useTranslation();
  const anchorRef = useRef<View | null>(null);
  const [open, setOpen] = useState(false);
  const openPicker = useCallback(() => setOpen(true), []);
  const select = useCallback(
    (id: string) => {
      onSelect(id);
      setOpen(false);
    },
    [onSelect],
  );
  const label = hosts.find((host) => host.serverId === serverId)?.label ?? serverId;

  return (
    <View style={styles.control}>
      <HostPicker
        hosts={hosts}
        value={serverId}
        onSelect={select}
        open={open}
        onOpenChange={setOpen}
        anchorRef={anchorRef}
        searchable={false}
        title={t("quickLaunch.host.title")}
        desktopPlacement="bottom-start"
        desktopMinWidth={200}
      >
        <ComboboxTrigger
          ref={anchorRef}
          onPress={openPicker}
          disabled={disabled}
          style={chipStyle}
          accessibilityRole="button"
          accessibilityLabel={t("quickLaunch.host.label", { host: label })}
          testID="quick-launch-host-trigger"
        >
          <View style={styles.chipIcon}>
            <HostStatusDot serverId={serverId} />
          </View>
          <Text style={styles.chipText} numberOfLines={1}>
            {label}
          </Text>
        </ComboboxTrigger>
      </HostPicker>
    </View>
  );
}

function chipStyle({ hovered, pressed }: { hovered: boolean; pressed: boolean }) {
  return [styles.chip, (hovered || pressed) && styles.chipHovered];
}

const styles = StyleSheet.create((theme) => ({
  input: {
    minHeight: 120,
    maxHeight: 280,
    backgroundColor: theme.colors.surface0,
    color: theme.colors.foreground,
    paddingVertical: theme.spacing[3],
    paddingHorizontal: theme.spacing[3],
    borderRadius: theme.borderRadius.lg,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    fontSize: theme.fontSize.content,
    textAlignVertical: "top",
  },
  destination: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: theme.spacing[2],
  },
  control: {
    minWidth: 0,
    flexShrink: 1,
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    height: 28,
    maxWidth: 280,
    paddingHorizontal: theme.spacing[2],
    borderRadius: theme.borderRadius["2xl"],
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    gap: theme.spacing[1],
  },
  chipHovered: {
    backgroundColor: theme.colors.surface2,
  },
  chipIcon: {
    width: theme.iconSize.md,
    height: theme.iconSize.md,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  chipText: {
    minWidth: 0,
    flexShrink: 1,
    fontSize: theme.fontSize.base,
    color: theme.colors.foreground,
  },
  projectIconFallbackText: {
    // A single initial inside a 16px square, below the smallest font-size token.
    fontSize: PROJECT_ICON_FALLBACK_FONT_SIZE,
    fontWeight: "600",
  },
  where: {
    alignSelf: "flex-start",
    maxWidth: "100%",
  },
  whereSegment: {
    flexShrink: 1,
    minWidth: 0,
  },
  agentControls: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: theme.spacing[1],
  },
  footerSpacer: {
    flex: 1,
  },
}));
