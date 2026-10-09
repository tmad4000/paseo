import type { SessionSearchResult } from "@getpaseo/protocol/messages";

export interface Recipient extends SessionSearchResult {
  serverId: string;
  projectViewKey: string;
  hostLabel: string;
}

/**
 * "Route to best match" auto-selects the top search result only when it is
 * near-certain on its own AND decisively ahead of the runner-up. The host
 * matcher reserves 0.90+ for a conversation the user clearly identifies, so
 * 0.85 admits only near-certain matches; vague prompts rank lower and fall
 * back to the candidate list. Passive Find/Send matching never auto-selects.
 */
export const ROUTE_AUTO_SELECT_MIN_CONFIDENCE = 0.85;
/**
 * Minimum confidence lead the top match must hold over the second-best result
 * before the route verb delivers without a manual choice. A missing runner-up
 * counts as confidence 0.
 */
export const ROUTE_AUTO_SELECT_MIN_MARGIN = 0.2;

export interface RouteAutoSelectThresholds {
  minConfidence: number;
  minMargin: number;
}

export const routeAutoSelectDefaults: RouteAutoSelectThresholds = {
  minConfidence: ROUTE_AUTO_SELECT_MIN_CONFIDENCE,
  minMargin: ROUTE_AUTO_SELECT_MIN_MARGIN,
};

/**
 * Pick the recipient the route verb may deliver to without a manual choice,
 * or null when the result set is empty, uncertain, or ambiguous. Order of the
 * input does not matter; confidence alone decides.
 */
export function selectRouteBestMatch(
  recipients: readonly Recipient[],
  thresholds: RouteAutoSelectThresholds = routeAutoSelectDefaults,
): Recipient | null {
  const ranked = [...recipients].sort((a, b) => b.confidence - a.confidence);
  const [top, second] = ranked;
  if (!top || top.confidence < thresholds.minConfidence) return null;
  if (top.confidence - (second?.confidence ?? 0) < thresholds.minMargin) return null;
  return top;
}

export type RoutingPhase =
  | { status: "idle" }
  | { status: "handoff" }
  | { status: "matching"; requestId: string; mode: "find" | "send"; text: string; route?: boolean }
  | {
      status: "results";
      requestId: string;
      mode: "find" | "send";
      text: string;
      recipients: Recipient[];
      notice: string;
      route?: boolean;
    }
  | {
      status: "sending";
      recipient: Recipient;
      text: string;
      itemId: string;
      draftVersion: number;
      draftUpdatedAt?: number;
      route?: boolean;
    }
  | {
      status: "pending";
      recipient: Recipient;
      text: string;
      itemId: string;
      draftVersion: number;
      draftUpdatedAt?: number;
      error: string;
      route?: boolean;
    }
  | {
      status: "acknowledged";
      recipient: Recipient;
      queued: boolean;
      warning?: string;
      route?: { text: string };
    }
  | { status: "error"; message: string };

export interface NewConversationWorkspace {
  serverId: string;
  workspaceId: string;
  projectViewKey: string;
  projectName: string;
  name: string;
}

export interface RoutingState {
  mode: "find" | "send";
  sendDraft: string;
  draftReady: boolean;
  draftVersion: number;
  draftUpdatedAt: number;
  scope: string | null;
  recipient: Recipient | null;
  deliveryMode: "queue" | "steer" | "interrupt";
  newConversation: boolean;
  newWorkspace: NewConversationWorkspace | null;
  picker: boolean;
  pickerQuery: string;
  phase: RoutingPhase;
}

export const initialRoutingState: RoutingState = {
  mode: "find",
  sendDraft: "",
  draftReady: false,
  draftVersion: 0,
  draftUpdatedAt: 0,
  scope: null,
  recipient: null,
  deliveryMode: "queue",
  newConversation: false,
  newWorkspace: null,
  picker: false,
  pickerQuery: "",
  phase: { status: "idle" },
};

export type RoutingAction =
  | { type: "syncDraft"; text: string; version: number; updatedAt?: number }
  | {
      type: "restoreDraft";
      text: string;
      version: number;
      updatedAt?: number;
      pending?: Extract<RoutingAction, { type: "restorePending" }>;
    }
  | { type: "clear" }
  | { type: "cancelMatch"; requestId: string }
  | { type: "hosts"; serverIds: readonly string[] }
  | {
      type: "restorePending";
      recipient: Recipient;
      text: string;
      itemId: string;
      draftVersion: number;
      draftUpdatedAt?: number;
    }
  | { type: "mode"; mode: RoutingState["mode"] }
  | { type: "draft"; text: string; version: number; updatedAt?: number }
  | { type: "scope"; scope: string | null }
  | { type: "recipient"; recipient: Recipient | null }
  | { type: "deliveryMode"; mode: RoutingState["deliveryMode"] }
  | { type: "newConversation"; workspace: NewConversationWorkspace | null }
  | { type: "newWorkspace"; workspace: NewConversationWorkspace }
  | { type: "picker"; open: boolean }
  | { type: "pickerQuery"; text: string }
  | { type: "receiptWarning"; message: string }
  | { type: "phase"; phase: RoutingPhase }
  | { type: "matched"; requestId: string; recipients: Recipient[]; notice: string }
  | { type: "acknowledged"; itemId: string; queued: boolean };

export function recipientInScope(
  recipient: Pick<Recipient, "projectViewKey">,
  scope: string | null,
): boolean {
  return scope === null || recipient.projectViewKey === scope;
}

export function routingReducer(state: RoutingState, action: RoutingAction): RoutingState {
  switch (action.type) {
    case "syncDraft":
      return {
        ...state,
        ...routingDraftFields(action),
      };
    case "restoreDraft":
      return restoreRoutingDraft(state, action);
    case "hosts":
      return updateRoutingHosts(state, action.serverIds);
    case "clear":
      return clearRoutingInput(state);
    case "cancelMatch":
      return cancelRoutingMatch(state, action.requestId);
    case "restorePending":
      return {
        ...state,
        mode: "send",
        recipient: action.recipient,
        phase: {
          status: "pending",
          recipient: action.recipient,
          text: action.text,
          itemId: action.itemId,
          draftVersion: action.draftVersion,
          draftUpdatedAt: action.draftUpdatedAt,
          error: "",
        },
      };
    case "mode":
      return { ...state, mode: action.mode, phase: { status: "idle" }, picker: false };
    case "draft":
      return editRoutingDraft(state, action);
    case "scope":
      return updateRoutingScope(state, action.scope);
    case "deliveryMode":
      return { ...state, deliveryMode: action.mode };
    case "newConversation":
      return {
        ...state,
        mode: "send",
        newConversation: true,
        newWorkspace: action.workspace,
        recipient: null,
        picker: false,
        phase: { status: "idle" },
      };
    case "newWorkspace":
      return { ...state, newWorkspace: action.workspace, phase: { status: "idle" } };
    case "recipient":
      return {
        ...state,
        recipient: action.recipient,
        newConversation: false,
        mode: "send",
        picker: false,
        phase: { status: "idle" },
      };
    case "picker":
      return { ...state, picker: action.open };
    case "pickerQuery":
      return { ...state, pickerQuery: action.text };
    case "receiptWarning":
      return applyReceiptWarning(state, action.message);
    case "phase":
      return { ...state, phase: action.phase };
    case "matched":
      return applyRoutingMatches(state, action);
    case "acknowledged":
      return acknowledgeRoutingState(state, action);
  }
}

function clearRoutingInput(state: RoutingState): RoutingState {
  if (ownsUnresolvedDelivery(state.phase)) return state;
  return { ...state, phase: { status: "idle" }, picker: false, pickerQuery: "" };
}

function editRoutingDraft(
  state: RoutingState,
  action: Extract<RoutingAction, { type: "draft" }>,
): RoutingState {
  if (ownsUnresolvedDelivery(state.phase)) return state;
  return {
    ...state,
    ...routingDraftFields(action),
    phase: state.phase.status === "results" ? state.phase : { status: "idle" },
  };
}

function cancelRoutingMatch(state: RoutingState, requestId: string): RoutingState {
  return state.phase.status === "matching" && state.phase.requestId === requestId
    ? { ...state, phase: { status: "idle" } }
    : state;
}

function acknowledgeRoutingState(
  state: RoutingState,
  action: Extract<RoutingAction, { type: "acknowledged" }>,
): RoutingState {
  const phase = state.phase;
  if ((phase.status !== "sending" && phase.status !== "pending") || phase.itemId !== action.itemId)
    return state;
  const sendDraft =
    state.draftVersion === phase.draftVersion &&
    state.draftUpdatedAt === (phase.draftUpdatedAt ?? 0)
      ? ""
      : state.sendDraft;
  return {
    ...state,
    sendDraft,
    phase: {
      status: "acknowledged",
      recipient: phase.recipient,
      queued: action.queued,
      route: phase.route ? { text: phase.text } : undefined,
    },
  };
}

function ownsUnresolvedDelivery(phase: RoutingPhase): boolean {
  return phase.status === "sending" || phase.status === "pending" || phase.status === "handoff";
}

function routingDraftFields(
  action: Extract<RoutingAction, { type: "draft" | "syncDraft" | "restoreDraft" }>,
) {
  return {
    sendDraft: action.text,
    draftVersion: action.version,
    draftUpdatedAt: action.updatedAt ?? 0,
  };
}

function restoreRoutingDraft(
  state: RoutingState,
  action: Extract<RoutingAction, { type: "restoreDraft" }>,
): RoutingState {
  const restored = { ...state, ...routingDraftFields(action), draftReady: true };
  return action.pending ? routingReducer(restored, action.pending) : restored;
}
function updateRoutingHosts(state: RoutingState, serverIds: readonly string[]): RoutingState {
  return {
    ...state,
    phase: ownsUnresolvedDelivery(state.phase) ? state.phase : { status: "idle" },
    recipient:
      state.recipient && serverIds.includes(state.recipient.serverId) ? state.recipient : null,
    newWorkspace:
      state.newWorkspace && serverIds.includes(state.newWorkspace.serverId)
        ? state.newWorkspace
        : null,
  };
}

function updateRoutingScope(state: RoutingState, scope: string | null): RoutingState {
  const recipient =
    state.recipient && recipientInScope(state.recipient, scope) ? state.recipient : null;
  return {
    ...state,
    scope: scope,
    recipient,
    newWorkspace:
      state.newWorkspace && recipientInScope(state.newWorkspace, scope) ? state.newWorkspace : null,
    picker: false,
    phase: { status: "idle" },
  };
}

function applyRoutingMatches(
  state: RoutingState,
  action: Extract<RoutingAction, { type: "matched" }>,
): RoutingState {
  if (state.phase.status !== "matching" || state.phase.requestId !== action.requestId) return state;
  const recipients = action.recipients.filter((recipient) =>
    recipientInScope(recipient, state.scope),
  );
  return {
    ...state,
    phase: {
      status: "results",
      requestId: action.requestId,
      mode: state.phase.mode,
      text: state.phase.text,
      recipients,
      notice: action.notice,
      route: state.phase.route,
    },
  };
}

function applyReceiptWarning(state: RoutingState, warning: string): RoutingState {
  return state.phase.status === "acknowledged"
    ? { ...state, phase: { ...state.phase, warning } }
    : state;
}
