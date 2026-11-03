import type { ReactElement } from "react";
import {
  AppWindow,
  Archive,
  ArrowLeftToLine,
  ArrowRightToLine,
  Circle,
  CircleCheck,
  Copy,
  CopyX,
  FileCode2,
  LayoutPanelLeft,
  ListOrdered,
  Pencil,
  RefreshCcwDot,
  RotateCw,
  Search,
  Send,
  Square,
  Trash2,
  X,
} from "lucide-react-native";
import { withUnistyles } from "react-native-unistyles";
import type { WorkspaceTabMenuIcon } from "@/screens/workspace/workspace-tab-menu";
import type { Theme } from "@/styles/theme";

const mutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

const ICONS = {
  "app-window": withUnistyles(AppWindow),
  archive: withUnistyles(Archive),
  "arrow-left-to-line": withUnistyles(ArrowLeftToLine),
  "arrow-right-to-line": withUnistyles(ArrowRightToLine),
  circle: withUnistyles(Circle),
  "circle-check": withUnistyles(CircleCheck),
  copy: withUnistyles(Copy),
  "copy-x": withUnistyles(CopyX),
  "file-code-2": withUnistyles(FileCode2),
  "layout-panel-left": withUnistyles(LayoutPanelLeft),
  "list-ordered": withUnistyles(ListOrdered),
  pencil: withUnistyles(Pencil),
  "refresh-ccw-dot": withUnistyles(RefreshCcwDot),
  "rotate-cw": withUnistyles(RotateCw),
  search: withUnistyles(Search),
  send: withUnistyles(Send),
  square: withUnistyles(Square),
  "trash-2": withUnistyles(Trash2),
  x: withUnistyles(X),
} satisfies Record<WorkspaceTabMenuIcon, unknown>;

/** One icon mapping for every tab menu surface (desktop context menu, mobile dropdown). */
export function renderWorkspaceTabMenuIcon(
  icon: WorkspaceTabMenuIcon | undefined,
): ReactElement | undefined {
  if (!icon) return undefined;
  const Icon = ICONS[icon];
  return <Icon size={16} uniProps={mutedColorMapping} />;
}
