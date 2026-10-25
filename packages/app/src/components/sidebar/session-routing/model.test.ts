import { describe, expect, test } from "vitest";
import {
  ROUTE_AUTO_SELECT_MIN_CONFIDENCE,
  ROUTE_AUTO_SELECT_MIN_MARGIN,
  initialRoutingState,
  routingReducer,
  selectRouteBestMatch,
  type Recipient,
} from "./model";

const recipient: Recipient = {
  serverId: "host-a",
  agentId: "chat",
  workspaceId: "workspace",
  projectId: "project",
  projectViewKey: "host-a:project",
  hostLabel: "M5",
  projectName: "Paseo",
  title: "Offline indicator",
  excerpt: "Investigating relay disconnect",
  confidence: 0.96,
};

describe("session routing decisions", () => {
  test("cancellation clears only its pending lookup and preserves completed results", () => {
    const matching = routingReducer(initialRoutingState, {
      type: "phase",
      phase: { status: "matching", mode: "find", requestId: "new", text: "offline" },
    });
    expect(routingReducer(matching, { type: "cancelMatch", requestId: "old" })).toBe(matching);
    const results = routingReducer(matching, {
      type: "matched",
      requestId: "new",
      recipients: [recipient],
      notice: "",
    });
    expect(routingReducer(results, { type: "cancelMatch", requestId: "old" })).toBe(results);
    expect(routingReducer(results, { type: "cancelMatch", requestId: "new" })).toBe(results);
    expect(routingReducer(matching, { type: "cancelMatch", requestId: "new" }).phase.status).toBe(
      "idle",
    );
  });
  test("finding and using a chat preserve the independent send draft without submitting", () => {
    let state = routingReducer(initialRoutingState, {
      type: "restoreDraft",
      text: "  fix it\n",
      version: 4,
    });
    state = routingReducer(state, {
      type: "phase",
      phase: { status: "matching", mode: "find", requestId: "find", text: "find the CI chat" },
    });
    state = routingReducer(state, {
      type: "matched",
      requestId: "find",
      recipients: [recipient],
      notice: "",
    });
    expect(state.phase.status).toBe("results");
    state = routingReducer(state, { type: "recipient", recipient });
    expect(state).toMatchObject({
      mode: "send",
      sendDraft: "  fix it\n",
      recipient,
      phase: { status: "idle" },
    });
    state = routingReducer(state, { type: "mode", mode: "find" });
    expect(state.sendDraft).toBe("  fix it\n");
  });
  test("scope includes host identity and clears incompatible explicit recipients", () => {
    const pinned = routingReducer(initialRoutingState, { type: "recipient", recipient });
    const scoped = routingReducer(pinned, { type: "scope", scope: "host-b:project" });
    expect(scoped.recipient).toBeNull();
    const matching = routingReducer(scoped, {
      type: "phase",
      phase: { status: "matching", requestId: "a", mode: "send", text: "continue" },
    });
    expect(
      routingReducer(matching, {
        type: "matched",
        requestId: "a",
        recipients: [recipient],
        notice: "",
      }).phase,
    ).toMatchObject({ recipients: [] });
  });
  test("superseded matching results and explicitly cleared Find results cannot survive", () => {
    let state = routingReducer(initialRoutingState, {
      type: "phase",
      phase: { status: "matching", mode: "find", requestId: "new", text: "offline" },
    });
    expect(
      routingReducer(state, {
        type: "matched",
        requestId: "old",
        recipients: [recipient],
        notice: "",
      }),
    ).toBe(state);
    state = routingReducer(state, { type: "clear" });
    expect(
      routingReducer(state, {
        type: "matched",
        requestId: "new",
        recipients: [recipient],
        notice: "",
      }).phase.status,
    ).toBe("idle");
  });
  test("only the matching item acknowledgement clears its owned draft; equal new text survives", () => {
    let state = routingReducer(initialRoutingState, {
      type: "restoreDraft",
      text: "continue",
      version: 8,
    });
    state = routingReducer(state, {
      type: "restorePending",
      recipient,
      text: "continue",
      itemId: "item",
      draftVersion: 8,
    });
    expect(routingReducer(state, { type: "acknowledged", itemId: "wrong", queued: true })).toBe(
      state,
    );
    expect(
      routingReducer(state, { type: "acknowledged", itemId: "item", queued: true }),
    ).toMatchObject({ sendDraft: "", phase: { status: "acknowledged", queued: true } });
    state = routingReducer(state, { type: "syncDraft", text: "continue", version: 10 });
    expect(
      routingReducer(state, { type: "acknowledged", itemId: "item", queued: false }),
    ).toMatchObject({ sendDraft: "continue", phase: { status: "acknowledged", queued: false } });
  });
  test("a recycled draft version after record collection still belongs to a different draft", () => {
    let state = routingReducer(initialRoutingState, {
      type: "restoreDraft",
      text: "continue",
      version: 1,
      updatedAt: 100,
    });
    state = routingReducer(state, {
      type: "restorePending",
      recipient,
      text: "continue",
      itemId: "old",
      draftVersion: 1,
      draftUpdatedAt: 100,
    });
    state = routingReducer(state, {
      type: "syncDraft",
      text: "continue",
      version: 1,
      updatedAt: 500000,
    });
    expect(
      routingReducer(state, { type: "acknowledged", itemId: "old", queued: false }).sendDraft,
    ).toBe("continue");
  });
});

test("new conversation keeps manual workspace and text until scope or host excludes it", () => {
  const workspace = {
    serverId: recipient.serverId,
    workspaceId: recipient.workspaceId,
    projectViewKey: recipient.projectViewKey,
    projectName: recipient.projectName,
    name: "main",
  };
  let state = routingReducer(initialRoutingState, {
    type: "restoreDraft",
    text: "new task",
    version: 1,
  });
  state = routingReducer(state, { type: "newConversation", workspace });
  expect(state).toMatchObject({
    newConversation: true,
    newWorkspace: workspace,
    sendDraft: "new task",
    recipient: null,
  });
  expect(routingReducer(state, { type: "scope", scope: "another" }).newWorkspace).toBeNull();
  expect(routingReducer(state, { type: "hosts", serverIds: [] }).newWorkspace).toBeNull();
  expect(
    routingReducer(state, { type: "hosts", serverIds: [recipient.serverId] }).newWorkspace,
  ).toEqual(workspace);
  expect(routingReducer(state, { type: "recipient", recipient }).newConversation).toBe(false);
});

test("delivery modes default to Queue and changing mode does not send", () => {
  expect(initialRoutingState.deliveryMode).toBe("queue");
  const state = routingReducer(
    { ...initialRoutingState, sendDraft: "keep" },
    { type: "deliveryMode", mode: "interrupt" },
  );
  expect(state).toMatchObject({
    deliveryMode: "interrupt",
    sendDraft: "keep",
    phase: { status: "idle" },
  });
});

test("failed draft cleanup after direct acknowledgement retains receipt without a retry state", () => {
  const state = routingReducer(
    { ...initialRoutingState, phase: { status: "acknowledged", recipient, queued: false } },
    { type: "receiptWarning", message: "Sent; draft cleanup failed" },
  );
  expect(state.phase).toEqual({
    status: "acknowledged",
    recipient,
    queued: false,
    warning: "Sent; draft cleanup failed",
  });
});

describe("retained lookup results", () => {
  function results(mode: "find" | "send") {
    const matching = routingReducer(
      { ...initialRoutingState, mode, sendDraft: "original" },
      {
        type: "phase",
        phase: { status: "matching", mode, requestId: "first", text: "original" },
      },
    );
    return routingReducer(matching, {
      type: "matched",
      requestId: "first",
      recipients: [recipient],
      notice: "Coverage",
    });
  }

  test.each(["find", "send"] as const)(
    "%s keeps candidates and original query when draft changes",
    (mode) => {
      const matched = results(mode);
      const edited = routingReducer(matched, { type: "draft", text: "revised", version: 2 });
      expect(edited.sendDraft).toBe("revised");
      expect(edited.phase).toBe(matched.phase);
      expect(edited.phase).toMatchObject({ text: "original", recipients: [recipient] });
      expect(routingReducer(edited, { type: "cancelMatch", requestId: "first" }).phase).toBe(
        matched.phase,
      );
      const synced = routingReducer(edited, { type: "syncDraft", text: "remote edit", version: 3 });
      expect(synced.phase).toBe(matched.phase);
    },
  );

  test.each(["find", "send"] as const)(
    "%s refresh replaces candidates only for the newly submitted request",
    (mode) => {
      const refreshing = routingReducer(results(mode), {
        type: "phase",
        phase: { status: "matching", mode, requestId: "second", text: "revised" },
      });
      expect(
        routingReducer(refreshing, {
          type: "matched",
          requestId: "first",
          recipients: [recipient],
          notice: "old response",
        }),
      ).toBe(refreshing);
      const updated = routingReducer(refreshing, {
        type: "matched",
        requestId: "second",
        recipients: [],
        notice: "new response",
      });
      expect(updated.phase).toMatchObject({
        status: "results",
        text: "revised",
        recipients: [],
        notice: "new response",
      });
    },
  );

  test("changing delivery mode keeps candidate matches and never sends", () => {
    const matched = results("send");
    const changed = routingReducer(matched, { type: "deliveryMode", mode: "steer" });
    expect(changed.deliveryMode).toBe("steer");
    expect(changed.phase).toBe(matched.phase);
  });

  test("editing a pending Send lookup rejects its eventual response", () => {
    const matching = routingReducer(results("send"), {
      type: "phase",
      phase: { status: "matching", mode: "send", requestId: "second", text: "original" },
    });
    const edited = routingReducer(matching, { type: "draft", text: "revised", version: 2 });
    expect(
      routingReducer(edited, {
        type: "matched",
        requestId: "second",
        recipients: [recipient],
        notice: "old response",
      }),
    ).toBe(edited);
  });

  test.each(["find", "send"] as const)(
    "%s Clear and scope or host changes discard candidates",
    (mode) => {
      const matched = results(mode);
      expect(routingReducer(matched, { type: "clear" })).toMatchObject({
        sendDraft: "original",
        phase: { status: "idle" },
      });
      expect(routingReducer(matched, { type: "scope", scope: "elsewhere" }).phase.status).toBe(
        "idle",
      );
      expect(routingReducer(matched, { type: "hosts", serverIds: ["host-b"] }).phase.status).toBe(
        "idle",
      );
    },
  );

  test("Clear and host changes preserve uncertain delivery ownership", () => {
    const pending = routingReducer(results("send"), {
      type: "restorePending",
      recipient,
      text: "original",
      itemId: "owned-item",
      draftVersion: 1,
    });
    expect(routingReducer(pending, { type: "clear" })).toBe(pending);
    expect(routingReducer(pending, { type: "draft", text: "lost edit", version: 2 })).toBe(pending);
    expect(routingReducer(pending, { type: "hosts", serverIds: [] }).phase).toBe(pending.phase);
    const handoff = routingReducer(pending, { type: "phase", phase: { status: "handoff" } });
    expect(routingReducer(handoff, { type: "clear" })).toBe(handoff);
  });
});

describe("route to best match auto-selection", () => {
  const candidate = (agentId: string, confidence: number): Recipient => ({
    ...recipient,
    agentId,
    confidence,
  });

  test("auto-selects only a near-certain top match with a decisive margin", () => {
    const clear = candidate("clear", 0.95);
    expect(selectRouteBestMatch([clear, candidate("faint", 0.4)])).toBe(clear);
    // A sole result competes against an implicit runner-up of 0.
    expect(selectRouteBestMatch([clear])).toBe(clear);
    // Input order must not matter; confidence alone ranks.
    expect(selectRouteBestMatch([candidate("faint", 0.4), clear])).toBe(clear);
  });

  test("exact threshold and margin boundaries are inclusive", () => {
    const top = candidate("top", ROUTE_AUTO_SELECT_MIN_CONFIDENCE);
    const second = candidate(
      "second",
      ROUTE_AUTO_SELECT_MIN_CONFIDENCE - ROUTE_AUTO_SELECT_MIN_MARGIN,
    );
    expect(selectRouteBestMatch([top, second])).toBe(top);
  });

  test("ambiguity, low confidence, and empty results all refuse auto-selection", () => {
    expect(selectRouteBestMatch([])).toBeNull();
    expect(selectRouteBestMatch([candidate("vague", 0.84)])).toBeNull();
    expect(selectRouteBestMatch([candidate("a", 0.95), candidate("b", 0.9)])).toBeNull();
    // Custom thresholds stay honored.
    expect(
      selectRouteBestMatch([candidate("a", 0.95), candidate("b", 0.875)], {
        minConfidence: 0.9,
        minMargin: 0.05,
      })?.agentId,
    ).toBe("a");
  });

  test("the route flag survives matching, results, delivery, and the receipt", () => {
    let state = routingReducer(
      { ...initialRoutingState, mode: "send", sendDraft: "continue" },
      {
        type: "phase",
        phase: {
          status: "matching",
          mode: "send",
          requestId: "route",
          text: "continue",
          route: true,
        },
      },
    );
    const results = routingReducer(state, {
      type: "matched",
      requestId: "route",
      recipients: [recipient],
      notice: "",
    });
    expect(results.phase).toMatchObject({ status: "results", route: true });
    state = routingReducer(state, {
      type: "phase",
      phase: {
        status: "sending",
        recipient,
        text: "continue",
        itemId: "routed-item",
        draftVersion: 0,
        route: true,
      },
    });
    const receipt = routingReducer(state, {
      type: "acknowledged",
      itemId: "routed-item",
      queued: true,
    });
    expect(receipt.phase).toMatchObject({
      status: "acknowledged",
      queued: true,
      route: { text: "continue" },
    });
  });

  test("a manual delivery receipt never offers the move-draft affordance", () => {
    const state = routingReducer(
      {
        ...initialRoutingState,
        phase: {
          status: "sending",
          recipient,
          text: "continue",
          itemId: "manual-item",
          draftVersion: 0,
        },
      },
      { type: "acknowledged", itemId: "manual-item", queued: true },
    );
    expect(state.phase).toMatchObject({ status: "acknowledged", route: undefined });
  });
});
