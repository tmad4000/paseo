import { useRef } from "react";
import type { NativeScrollEvent, NativeSyntheticEvent } from "react-native";
import { useKeyboardShift } from "@/keyboard/shift";
import { dismissSoftwareKeyboard } from "@/keyboard/software-keyboard-dismiss";
import { useStableEvent } from "@/hooks/use-stable-event";
import {
  beginDrag,
  IDLE_SCROLL_KEYBOARD_DISMISS_GESTURE,
  recordScroll,
  releaseDrag,
} from "./model";

type ScrollEvent = NativeSyntheticEvent<NativeScrollEvent>;

/**
 * Owns the chat history's flick-to-dismiss behavior. The native stream only
 * forwards the FlatList scroll lifecycle; removing this hook and those three
 * calls removes the feature completely.
 */
export function useScrollKeyboardDismiss() {
  const { shift } = useKeyboardShift();
  const gestureRef = useRef(IDLE_SCROLL_KEYBOARD_DISMISS_GESTURE);

  const onScrollBeginDrag = useStableEvent((event: ScrollEvent) => {
    gestureRef.current = beginDrag(event);
  });

  const onScroll = useStableEvent((event: ScrollEvent) => {
    gestureRef.current = recordScroll(gestureRef.current, event);
  });

  const onScrollEndDrag = useStableEvent((event: ScrollEvent) => {
    const release = releaseDrag(gestureRef.current, event);
    gestureRef.current = release.gesture;

    // `shift` is the app's UI-thread-derived keyboard inset. Besides avoiding a
    // second calculation on JS, this prevents a hardware keyboard's focused
    // composer from being blurred when no software keyboard occupies space.
    if (!release.shouldDismiss || shift.value <= 0) {
      return;
    }

    dismissSoftwareKeyboard();
  });

  return { onScroll, onScrollBeginDrag, onScrollEndDrag };
}
