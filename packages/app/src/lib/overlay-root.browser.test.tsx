import React, { useCallback, type RefCallback } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useWebOverlayRegistration } from "./overlay-root";

const enteringOverlayStyle = { height: 600, paddingTop: 300 };

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function OverlayHarness({ active, showScope }: { active: boolean; showScope: boolean }) {
  const setScope = useWebOverlayRegistration({ active, layer: 20, onKeyDown: () => false });
  return showScope ? (
    <div data-testid="scope" ref={setScope as RefCallback<HTMLDivElement>} tabIndex={-1}>
      <input data-testid="overlay-input" />
    </div>
  ) : null;
}

// RN Web/Unistyles can rebind a host ref while an animated closing sheet
// retains its input. React then preserves that input's selection during commit.
function RetainedOverlayHarness({
  active,
  successorOpen = false,
}: {
  active: boolean;
  successorOpen?: boolean;
}) {
  const setScope = useWebOverlayRegistration({ active, layer: 20, onKeyDown: () => false });
  const setSuccessor = useWebOverlayRegistration({
    active: successorOpen,
    layer: 40,
    onKeyDown: () => false,
  });
  const bindScope = useCallback(
    (node: HTMLDivElement | null) => {
      if (node) node.dataset.overlayActive = String(active);
      setScope(node);
    },
    [active, setScope],
  );
  return (
    <>
      <div ref={bindScope} tabIndex={-1}>
        <input data-testid="retained-input" />
      </div>
      {successorOpen ? (
        <div ref={setSuccessor as RefCallback<HTMLDivElement>} tabIndex={-1}>
          <input data-testid="successor-input" autoFocus />
        </div>
      ) : null}
    </>
  );
}

describe("useWebOverlayRegistration in the browser", () => {
  let root: Root;
  let container: HTMLDivElement;
  let opener: HTMLButtonElement;

  beforeEach(() => {
    container = document.createElement("div");
    opener = document.createElement("button");
    opener.textContent = "Open";
    document.body.append(opener, container);
    root = createRoot(container);
    opener.focus();
  });

  afterEach(() => {
    root.unmount();
    document.body.replaceChildren();
  });

  async function renderHarness(active: boolean, showScope: boolean): Promise<void> {
    flushSync(() => {
      root.render(<OverlayHarness active={active} showScope={showScope} />);
    });
    await nextFrame();
  }

  it("focuses an entering overlay without scrolling its clipped ancestors", async () => {
    container.style.height = "120px";
    container.style.overflow = "hidden";
    function EnteringOverlay() {
      const setScope = useWebOverlayRegistration({
        active: true,
        layer: 20,
        onKeyDown: () => false,
      });
      return (
        <div
          ref={setScope as RefCallback<HTMLDivElement>}
          style={enteringOverlayStyle}
          tabIndex={-1}
        >
          <input data-testid="entering-input" />
        </div>
      );
    }
    flushSync(() => root.render(<EnteringOverlay />));
    await nextFrame();
    expect(document.activeElement).toBe(container.querySelector("input"));
    expect(container.scrollTop).toBe(0);
    opener.focus();
    await nextFrame();
    expect(document.activeElement).toBe(container.querySelector("input"));
    expect(container.scrollTop).toBe(0);
  });

  it("restores the opener without scrolling its clipped ancestors", async () => {
    const clipped = document.createElement("div");
    clipped.style.height = "120px";
    clipped.style.overflow = "hidden";
    const spacer = document.createElement("div");
    spacer.style.height = "300px";
    clipped.append(spacer, opener);
    document.body.prepend(clipped);
    opener.focus({ preventScroll: true });
    await renderHarness(true, true);
    expect(clipped.scrollTop).toBe(0);
    await renderHarness(false, false);
    expect(document.activeElement).toBe(opener);
    expect(clipped.scrollTop).toBe(0);
  });

  it("restores focus after a closing host rebinds while retaining its input", async () => {
    flushSync(() => root.render(<RetainedOverlayHarness active />));
    await nextFrame();
    expect(document.activeElement).toBe(container.querySelector('[data-testid="retained-input"]'));
    flushSync(() => root.render(<RetainedOverlayHarness active={false} />));
    await nextFrame();
    expect(container.querySelector('[data-testid="retained-input"]')).toBeTruthy();
    expect(document.activeElement).toBe(opener);
  });

  it("does not restore a closing overlay's opener over a new top overlay", async () => {
    flushSync(() => root.render(<RetainedOverlayHarness active />));
    await nextFrame();
    const originalFocus = opener.focus.bind(opener);
    let openerFocusCalls = 0;
    opener.focus = (options) => {
      openerFocusCalls++;
      originalFocus(options);
    };
    flushSync(() => root.render(<RetainedOverlayHarness active={false} successorOpen />));
    await nextFrame();
    expect(document.activeElement).toBe(container.querySelector('[data-testid="successor-input"]'));
    expect(openerFocusCalls).toBe(0);
  });

  it("does not restore an old opener when its overlay reopens before return", async () => {
    flushSync(() => root.render(<RetainedOverlayHarness active />));
    await nextFrame();
    const originalFocus = opener.focus.bind(opener);
    let openerFocusCalls = 0;
    opener.focus = (options) => {
      openerFocusCalls++;
      originalFocus(options);
    };
    flushSync(() => root.render(<RetainedOverlayHarness active={false} />));
    flushSync(() => root.render(<RetainedOverlayHarness active />));
    await nextFrame();
    expect(document.activeElement).toBe(container.querySelector('[data-testid="retained-input"]'));
    expect(openerFocusCalls).toBe(0);
  });

  it("skips focus restoration for active scope detach but restores focus when closing", async () => {
    await renderHarness(true, true);

    const input = document.querySelector<HTMLInputElement>('[data-testid="overlay-input"]');
    expect(input).toBeTruthy();
    input?.focus();
    await nextFrame();
    expect(document.activeElement).not.toBe(opener);

    const originalFocus = opener.focus.bind(opener);
    let openerFocusCalls = 0;
    opener.focus = () => {
      openerFocusCalls += 1;
      originalFocus();
    };

    await renderHarness(true, false);

    expect(openerFocusCalls).toBe(0);

    await renderHarness(false, false);

    expect(openerFocusCalls).toBe(1);
  });
});
