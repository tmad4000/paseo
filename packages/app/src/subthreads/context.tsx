import { createContext, useContext } from "react";
import type { SidePanelMode, SubthreadSelection, SubthreadSummary } from "./model";

/**
 * The orchestrator pane's handle on its subthreads drawer. Present only inside an agent pane
 * that hosts a drawer; a subthread rendered inside the drawer sees `null`, so the drawer never
 * nests and a child's own controls never open a second one.
 */
export interface SubthreadsHostValue {
  isOpen: boolean;
  mode: SidePanelMode;
  summary: SubthreadSummary;
  /** The session has a linked checklist page (`paseo.checklist-url`). */
  hasChecklistLink: boolean;
  /** Opens the subagents list (or a given subagent). */
  open: (selection?: SubthreadSelection | null) => void;
  openChecklist: () => void;
  close: () => void;
  /** Keyboard semantics: open, move into the drawer, then close. */
  toggle: () => void;
}

export const SubthreadsHostContext = createContext<SubthreadsHostValue | null>(null);

export function useSubthreadsHost(): SubthreadsHostValue | null {
  return useContext(SubthreadsHostContext);
}

/**
 * Names the agent a composer will send to when it is not the pane's own agent. The composer
 * turns it into its placeholder, so the target is visible in the field being typed into.
 */
export interface SubthreadReplyTarget {
  agentId: string;
  label: string;
}

export const SubthreadReplyTargetContext = createContext<SubthreadReplyTarget | null>(null);

export function useSubthreadReplyTarget(agentId: string | undefined): SubthreadReplyTarget | null {
  const target = useContext(SubthreadReplyTargetContext);
  // Guard against a target leaking to a composer for a different agent.
  return target && target.agentId === agentId ? target : null;
}

/** The recipient's name for a composer inside a subagents drawer; null everywhere else. */
export function useSubthreadReplyLabel(agentId: string | undefined): string | null {
  const target = useSubthreadReplyTarget(agentId);
  return target ? target.label : null;
}
