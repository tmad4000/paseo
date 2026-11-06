// Pinned projects and the per-host Default project. See docs/sidebar-sorting.md and
// docs/session-routing.md for the behavior; `useDefaultProjectForHost` is the one resolver every
// "where does new work go" surface reads.
export {
  orderProjectsWithPins,
  resolveDefaultProjectPlacements,
  resolveProjectPickerSectionStarts,
  resolveDefaultProjectWorkspaceId,
  resolveProjectPinState,
  selectHostDefaultProject,
  splitPinnedProjects,
  type DefaultProjectPlacement,
  type HostProjectRef,
  type ProjectPickerSection,
  type ProjectPinState,
} from "./model";
export {
  selectDefaultProjectForHost,
  useDefaultProjectForHost,
  useDefaultProjectPlacements,
  useProjectPinState,
  useProjectPinStates,
  type DefaultProject,
} from "./hooks";
export { usePinnedProjectOrderStore } from "./pinned-project-order-store";
export { useProjectPinActions, type ProjectPinActions } from "./use-project-pin-actions";
export {
  PinnedProjectsDivider,
  ProjectPinGlyph,
  useProjectPinMenuItems,
  type ProjectPinMenuItem,
} from "./project-pin-ui";
export {
  ProjectPickerPinToggle,
  ProjectPickerSectionHeader,
  useProjectPickerPinOrdering,
  type ProjectPickerPinOrdering,
} from "./project-picker-ui";
