import React, { act, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  useSidebarFilterRequestFocus,
  useSidebarFilterRequestStore,
  type SidebarFindFieldHandle,
} from "./sidebar-filter-request";

const field = {
  replaceText: vi.fn<(text: string) => void>(),
  focus: vi.fn<() => void>(),
};

function FindField() {
  const ref = useRef<SidebarFindFieldHandle>(field);
  useSidebarFilterRequestFocus(ref);
  return null;
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  field.replaceText.mockClear();
  field.focus.mockClear();
  useSidebarFilterRequestStore.setState({ request: null, focusedRequestId: 0 });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function nextTask() {
  return new Promise((resolve) => setTimeout(resolve, 10));
}

test("a command center request fills and focuses the find field exactly once", async () => {
  await act(async () => root.render(<FindField />));
  await act(async () => {
    useSidebarFilterRequestStore.getState().requestSidebarFilter("quokka");
    await nextTask();
  });
  expect(field.replaceText).toHaveBeenCalledWith("quokka");
  expect(field.focus).toHaveBeenCalledOnce();
  expect(useSidebarFilterRequestStore.getState().focusedRequestId).toBe(1);

  // Remounting the sidebar must not take focus again for a request already handled.
  await act(async () => root.render(<React.Fragment key="remount"><FindField /></React.Fragment>));
  await act(async () => {
    await nextTask();
  });
  expect(field.focus).toHaveBeenCalledOnce();

  await act(async () => {
    useSidebarFilterRequestStore.getState().requestSidebarFilter("wombat");
    await nextTask();
  });
  expect(field.replaceText).toHaveBeenLastCalledWith("wombat");
  expect(field.focus).toHaveBeenCalledTimes(2);
});
