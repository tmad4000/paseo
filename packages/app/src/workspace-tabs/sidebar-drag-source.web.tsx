import { useCallback, useRef, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { claimActiveReorderDrop } from "@/components/drag-reorder";
import {
  getSidebarDropHost,
  resolveSidebarDropZone,
  setSidebarDragState,
  type DropRect,
  type SidebarDragPayload,
  type SidebarDropTarget,
} from "./sidebar-session-drop";

const ACTIVATION_DISTANCE = 6;
const CONTENTS_STYLE = { display: "contents" } as const;

function toRect(element: Element): DropRect {
  const { left, top, width, height } = element.getBoundingClientRect();
  return { left, top, width, height };
}

/** Panes and tab strips are tagged by split-container through `dataSet`. */
function hitTest(
  doc: Document,
  x: number,
  y: number,
  workspaceKey: string,
): SidebarDropTarget | null {
  const pane = doc.elementFromPoint(x, y)?.closest<HTMLElement>("[data-sidebar-drop-pane]");
  const paneId = pane?.dataset.sidebarDropPane;
  if (!pane || !paneId || pane.dataset.sidebarDropWorkspace !== workspaceKey) return null;
  const tabs = pane.querySelector("[data-sidebar-drop-tabs]");
  const zone = resolveSidebarDropZone({
    paneRect: toRect(pane),
    tabsRect: tabs ? toRect(tabs) : null,
    x,
    y,
  });
  return zone ? { workspaceKey, paneId, zone } : null;
}

function createGhost(source: Element, doc: Document): HTMLElement {
  const row = source.firstElementChild ?? source;
  const rect = row.getBoundingClientRect();
  const ghost = row.cloneNode(true) as HTMLElement;
  ghost.removeAttribute("data-testid");
  for (const node of ghost.querySelectorAll("[data-testid]")) node.removeAttribute("data-testid");
  Object.assign(ghost.style, {
    position: "fixed",
    left: "0px",
    top: "0px",
    width: `${Math.min(rect.width, 280)}px`,
    margin: "0",
    pointerEvents: "none",
    opacity: "0.85",
    zIndex: "10000",
    borderRadius: "6px",
    boxShadow: "0 6px 18px rgba(0, 0, 0, 0.25)",
  });
  ghost.setAttribute("aria-hidden", "true");
  doc.body.appendChild(ghost);
  return ghost;
}

let cancelCurrentDrag: (() => void) | null = null;

/**
 * Follows a mouse press on a sidebar row. Nothing happens while the pointer stays in the sidebar,
 * so the list's own reorder drag (and plain clicks) behave as before. Once the pointer is over a
 * pane of the workspace on screen, the press becomes a cross drop: a ghost follows the pointer,
 * the pane shows where it would land, and releasing there opens the session.
 */
function startSidebarSessionDrag(input: {
  payload: SidebarDragPayload;
  source: HTMLElement;
  pointerId: number;
  x: number;
  y: number;
}): void {
  cancelCurrentDrag?.();
  const { payload, source, pointerId } = input;
  const doc = source.ownerDocument;
  const view = doc.defaultView;
  if (!view) return;
  const win: Window = view;
  let active = false;
  let ghost: HTMLElement | null = null;
  let target: SidebarDropTarget | null = null;
  let previousUserSelect = "";

  const finish = () => {
    win.removeEventListener("pointermove", handleMove, true);
    win.removeEventListener("pointerup", handleUp, true);
    win.removeEventListener("pointercancel", finish, true);
    win.removeEventListener("keydown", handleKeyDown, true);
    win.removeEventListener("blur", finish);
    ghost?.remove();
    ghost = null;
    if (active) doc.body.style.userSelect = previousUserSelect;
    if (cancelCurrentDrag === finish) cancelCurrentDrag = null;
    setSidebarDragState({ active: false, target: null });
  };

  function activate() {
    active = true;
    // A reorder drag of the same row may be running in the sidebar list: it must not also move it.
    claimActiveReorderDrop();
    previousUserSelect = doc.body.style.userSelect;
    doc.body.style.userSelect = "none";
    win.getSelection()?.removeAllRanges();
    ghost = createGhost(source, doc);
  }

  function handleMove(event: PointerEvent) {
    if (event.pointerId !== pointerId) return;
    const host = getSidebarDropHost();
    const hit = host ? hitTest(doc, event.clientX, event.clientY, host.workspaceKey) : null;
    if (!active) {
      const distance = Math.hypot(event.clientX - input.x, event.clientY - input.y);
      if (distance < ACTIVATION_DISTANCE || !hit) return;
      activate();
    }
    target = hit;
    if (ghost) ghost.style.transform = `translate(${event.clientX + 12}px, ${event.clientY + 8}px)`;
    setSidebarDragState({ active: true, target });
  }

  function handleUp(event: PointerEvent) {
    if (event.pointerId !== pointerId) return;
    const dropTarget = active ? target : null;
    finish();
    const host = getSidebarDropHost();
    if (dropTarget && host && host.workspaceKey === dropTarget.workspaceKey) {
      host.drop(payload, dropTarget);
    }
  }

  function handleKeyDown(event: KeyboardEvent) {
    if (!active || event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    finish();
  }

  win.addEventListener("pointermove", handleMove, true);
  win.addEventListener("pointerup", handleUp, true);
  win.addEventListener("pointercancel", finish, true);
  win.addEventListener("keydown", handleKeyDown, true);
  win.addEventListener("blur", finish);
  cancelCurrentDrag = finish;
}

/**
 * Makes a sidebar row draggable onto the workspace on screen (desktop/web, mouse only; touch keeps
 * the list's long-press reorder). Renders no box of its own.
 */
export function SidebarDragSource({
  payload,
  children,
}: {
  payload: SidebarDragPayload;
  children: ReactNode;
}) {
  const payloadRef = useRef(payload);
  payloadRef.current = payload;
  const handlePointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || event.pointerType === "touch") return;
    startSidebarSessionDrag({
      payload: payloadRef.current,
      source: event.currentTarget,
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
    });
  }, []);
  return (
    <div style={CONTENTS_STYLE} onPointerDownCapture={handlePointerDown}>
      {children}
    </div>
  );
}
