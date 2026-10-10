import { useCallback, useRef } from "react";
import type { NativeSyntheticEvent, TextInputKeyPressEventData } from "react-native";

export type QuickLaunchKeyPressEvent = NativeSyntheticEvent<
  TextInputKeyPressEventData & { metaKey?: boolean; ctrlKey?: boolean; shiftKey?: boolean }
>;

/**
 * Start fires at most once per dialog. On web the card stays mounted through its exit fade with
 * the prompt still in the input, so a second Mod+Enter, key repeat, or click would otherwise create
 * a second agent: every Start gets a new launch id and the daemon does not dedupe create_agent.
 * `submit` returns whether it started; a refused start (nothing to send yet) does not latch.
 */
export function useQuickLaunchSubmit(input: {
  visible: boolean;
  submit: (openAfterStart: boolean) => boolean;
}) {
  const submittedRef = useRef(false);
  const { visible, submit } = input;
  const start = useCallback(
    (openAfterStart: boolean) => {
      if (!visible || submittedRef.current) return;
      submittedRef.current = submit(openAfterStart);
    },
    [submit, visible],
  );
  const handleKeyPress = useCallback(
    (event: QuickLaunchKeyPressEvent) => {
      const { key, metaKey, ctrlKey, shiftKey } = event.nativeEvent;
      if (key !== "Enter" || !(metaKey || ctrlKey)) return;
      event.preventDefault();
      start(shiftKey === true);
    },
    [start],
  );
  return { start, handleKeyPress };
}
