import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { ReactElement } from "react";
import { useTranslation } from "react-i18next";
import {
  Text,
  View,
  type NativeSyntheticEvent,
  type TextInputKeyPressEventData,
} from "react-native";
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
import { useFormPreferences } from "@/hooks/use-form-preferences";
import {
  filterWorkspaceProjectsForHost,
  getHostProjectSourceDirectory,
  getWorktreeSupportForHostProject,
  useHostProjects,
  type HostProjectListItem,
} from "@/projects/host-projects";
import { useProjectIcons } from "@/projects/icons";
import { useHostFeature } from "@/runtime/host-features";
import { useHosts } from "@/runtime/host-runtime";
import { buildNewWorkspaceProjectIconTargets } from "@/screens/new-workspace/project-icon-targets";
import { generateDraftId, QUICK_LAUNCH_DRAFT_KEY } from "@/stores/draft-keys";
import { useWorkspace } from "@/stores/session-store-hooks";
import type { HostProfile } from "@/types/host-connection";
import { projectIconPlaceholderLabelFromDisplayName } from "@/utils/project-display-name";
import {
  findProjectChoice,
  findProjectForWorkspace,
  resolveQuickLaunchDefaultDestination,
  resolveQuickLaunchTarget,
  type QuickLaunchProjectChoice,
  type QuickLaunchWhere,
  type QuickLaunchWorkspaceRef,
} from "./destination";
import type { QuickLaunchSubmission } from "./launch";
import type { QuickLaunchPrefill, QuickLaunchSession } from "./store";

export interface QuickLaunchStartRequest {
  submission: QuickLaunchSubmission;
  openAfterStart: boolean;
  projectName: string;
  /** `null` when the agent starts in a new workspace. */
  workspaceName: string | null;
  /** Reopens the dialog on the same destination when the start fails. */
  retry: QuickLaunchPrefill;
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
const PROJECT_ICON_FALLBACK_FONT_SIZE = 10;

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
  const prefill = session.prefill;
  const hosts = useHosts();
  const serverIds = useMemo(() => hosts.map((host) => host.serverId), [hosts]);
  const projects = useHostProjects(serverIds);

  const anchor = prefill?.workspace ?? active;
  const anchorWorkspace = useWorkspace(anchor?.serverId ?? null, anchor?.workspaceId ?? null);
  const [where, setWhere] = useState<QuickLaunchWhere>(
    prefill?.where ?? (prefill?.workspace ? "existing-workspace" : "new-workspace"),
  );
  const effectiveWhere: QuickLaunchWhere =
    where === "existing-workspace" && anchor && anchorWorkspace
      ? "existing-workspace"
      : "new-workspace";

  const defaultDestination = useMemo(
    () => resolveQuickLaunchDefaultDestination({ projects, serverIds, active }),
    [active, projects, serverIds],
  );
  const [manualProject, setManualProject] = useState<QuickLaunchProjectChoice | null>(
    prefill?.project ?? null,
  );
  const projectChoice = manualProject ?? defaultDestination;
  const projectServerId = projectChoice?.serverId ?? active?.serverId ?? serverIds[0] ?? "";
  const supportsMultiplicity = useHostFeature(projectServerId, "workspaceMultiplicity");
  const projectsOnHost = useMemo(
    () =>
      filterWorkspaceProjectsForHost({
        projects,
        serverId: projectServerId,
        allowAllProjects: supportsMultiplicity,
      }),
    [projectServerId, projects, supportsMultiplicity],
  );
  const chosenProject = findProjectChoice(projectsOnHost, projectChoice);
  const anchorProject = anchor ? findProjectForWorkspace(projects, anchor) : null;
  const shownProject = effectiveWhere === "existing-workspace" ? anchorProject : chosenProject;
  const serverId =
    effectiveWhere === "existing-workspace" && anchor ? anchor.serverId : projectServerId;

  const { preferences: formPreferences } = useFormPreferences();
  const target = resolveQuickLaunchTarget({
    where: effectiveWhere,
    workspace:
      anchor && anchorWorkspace
        ? {
            serverId: anchor.serverId,
            workspaceId: anchor.workspaceId,
            workspaceDirectory: anchorWorkspace.workspaceDirectory,
          }
        : null,
    project: chosenProject,
    serverId: projectServerId,
    supportsMultiplicity,
    isolation: formPreferences.isolation ?? "local",
    worktreeSupport: chosenProject
      ? getWorktreeSupportForHostProject({ project: chosenProject, serverId: projectServerId })
      : "unknown",
  });
  const workingDir =
    target?.kind === "existing-workspace" ? target.workspaceDirectory : target?.sourceDirectory;

  const composerOptions = useMemo(
    () => ({
      initialServerId: serverId || null,
      isVisible: visible,
      lockedWorkingDir: workingDir,
    }),
    [serverId, visible, workingDir],
  );
  const draft = useAgentInputDraft({ draftKey: QUICK_LAUNCH_DRAFT_KEY, composer: composerOptions });
  const composerState = draft.composerState;
  const text = useSyncExternalStore(
    draft.textSource.subscribe,
    draft.textSource.getSnapshot,
    draft.textSource.getSnapshot,
  );
  const inputRef = useRef<EditingTextInputHandle | null>(null);

  // A prefill (Retry, or a prompt handed over from the sidebar) replaces the saved draft once the
  // draft store has loaded it, so the hydrated text cannot overwrite the handed-over prompt.
  const prefillText = prefill?.text;
  const appliedPrefillRef = useRef(false);
  const { isHydrated, replaceText } = draft;
  useEffect(() => {
    if (!isHydrated || appliedPrefillRef.current || prefillText === undefined) return;
    appliedPrefillRef.current = true;
    replaceText(prefillText);
  }, [isHydrated, prefillText, replaceText]);

  const projectIconTargets = useMemo(
    () => buildNewWorkspaceProjectIconTargets(projects, serverId),
    [projects, serverId],
  );
  const projectIcons = useProjectIcons({ projects: projectIconTargets });

  const clearDraft = draft.clear;
  const anchorWorkspaceName = anchorWorkspace?.name ?? null;
  const start = useCallback(
    (openAfterStart: boolean) => {
      const prompt = (inputRef.current?.getText() ?? text).trim();
      const provider = composerState?.selectedProvider;
      if (!prompt || !target || !shownProject || !composerState || !provider) return;
      void composerState.persistFormPreferences();
      const workspaceName = target.kind === "existing-workspace" ? anchorWorkspaceName : null;
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
        workspaceName,
        retry: {
          text: prompt,
          where: effectiveWhere,
          ...(anchor ? { workspace: anchor } : {}),
          ...(projectChoice ? { project: projectChoice } : {}),
        },
      });
      clearDraft("sent");
    },
    [
      anchor,
      anchorWorkspaceName,
      clearDraft,
      composerState,
      effectiveWhere,
      onStart,
      projectChoice,
      shownProject,
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

  const handleSelectProject = useCallback(
    (projectViewKey: string) => {
      setManualProject({ serverId: projectServerId, projectViewKey });
    },
    [projectServerId],
  );
  const handleSelectHost = useCallback(
    (nextServerId: string) => {
      if (chosenProject?.hosts.some((host) => host.serverId === nextServerId)) {
        setManualProject({ serverId: nextServerId, projectViewKey: chosenProject.viewKey });
        return;
      }
      setManualProject(
        resolveQuickLaunchDefaultDestination({
          projects,
          serverIds: [nextServerId],
          active: null,
        }) ?? { serverId: nextServerId, projectViewKey: null },
      );
    },
    [chosenProject, projects],
  );

  const whereOptions = useMemo<SegmentedControlOption<QuickLaunchWhere>[]>(() => {
    const options: SegmentedControlOption<QuickLaunchWhere>[] = [
      {
        value: "new-workspace",
        label: t("quickLaunch.where.newWorkspace"),
        testID: "quick-launch-where-new-workspace",
      },
    ];
    if (anchorWorkspace) {
      options.push({
        value: "existing-workspace",
        label: t("quickLaunch.where.newTab", { workspace: anchorWorkspace.name }),
        testID: "quick-launch-where-existing-workspace",
      });
    }
    return options;
  }, [anchorWorkspace, t]);

  const header = useMemo(() => ({ title: t("quickLaunch.title") }), [t]);
  const canStart = Boolean(text.trim() && target && shownProject && composerState?.selectedProvider);
  const agentControls = composerState?.agentControls;

  const footer = (
    <>
      <View style={styles.footerSpacer} />
      <Button
        variant="secondary"
        size="sm"
        onPress={startAndOpen}
        disabled={!canStart}
        trailing={<Shortcut keys={START_AND_OPEN_KEYS} />}
        accessibilityHint={t("quickLaunch.actions.startAndOpenHint")}
        testID="quick-launch-start-and-open"
      >
        {t("quickLaunch.actions.startAndOpen")}
      </Button>
      <Button
        variant="default"
        size="sm"
        onPress={startInBackground}
        disabled={!canStart}
        trailing={<Shortcut keys={START_KEYS} />}
        accessibilityHint={t("quickLaunch.actions.startHint")}
        testID="quick-launch-start"
      >
        {t("quickLaunch.actions.start")}
      </Button>
    </>
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
          projects={projectsOnHost}
          selectedProjectViewKey={shownProject?.viewKey ?? null}
          projectName={shownProject?.projectName ?? null}
          iconDataUri={shownProject ? (projectIcons.get(shownProject.viewKey) ?? null) : null}
          disabled={effectiveWhere === "existing-workspace"}
          serverId={projectServerId}
          onSelect={handleSelectProject}
        />
        {hosts.length > 1 ? (
          <QuickLaunchHostPicker
            hosts={hosts}
            serverId={serverId}
            disabled={effectiveWhere === "existing-workspace"}
            onSelect={handleSelectHost}
          />
        ) : null}
      </View>
      {whereOptions.length > 1 ? (
        <SegmentedControl
          options={whereOptions}
          value={effectiveWhere}
          onValueChange={setWhere}
          size="xs"
          style={styles.where}
          segmentStyle={styles.whereSegment}
          testID="quick-launch-where"
        />
      ) : null}
      {agentControls ? (
        <View style={styles.agentControls} testID="quick-launch-agent-controls">
          <DraftAgentControls {...agentControls} isCompactLayout={isCompact} />
        </View>
      ) : null}
    </AdaptiveModalSheet>
  );
}

const SNAP_POINTS = ["70%", "92%"];

function QuickLaunchProjectPicker({
  projects,
  selectedProjectViewKey,
  projectName,
  iconDataUri,
  disabled,
  serverId,
  onSelect,
}: {
  projects: HostProjectListItem[];
  selectedProjectViewKey: string | null;
  projectName: string | null;
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
  const label = projectName ?? t("quickLaunch.project.choose");
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
