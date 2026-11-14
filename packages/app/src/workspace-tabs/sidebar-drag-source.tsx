import type { ReactNode } from "react";
import type { SidebarDragPayload } from "./sidebar-session-drop";

/** Native: sidebar rows are not drag sources (pane splits are web-only). See the `.web` file. */
export function SidebarDragSource({
  children,
}: {
  payload: SidebarDragPayload;
  children: ReactNode;
}): ReactNode {
  return children;
}
