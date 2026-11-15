import { useEffect, useRef, type RefObject } from "react";
import type { GestureResponderEvent, View } from "react-native";
import { isWeb } from "@/constants/platform";

/**
 * Web and desktop: Mod+click on something that peeks asks for its tab directly, the way a link
 * opens in a new tab. Native has no such gesture; the peek's own Open in tab is one press away.
 */
export function wantsTabInstead(event: GestureResponderEvent | null | undefined): boolean {
  if (!isWeb || !event) return false;
  const native = event.nativeEvent as unknown as { metaKey?: boolean; ctrlKey?: boolean } | null;
  return Boolean(native?.metaKey || native?.ctrlKey);
}

/**
 * Web: a middle-click on a peek target opens its tab. Pressable does not report the middle
 * button, so the listener sits on the element itself.
 */
export function useMiddleClickOpensTab(
  ref: RefObject<View | null>,
  onOpenTab: (() => void) | null,
): void {
  const handlerRef = useRef(onOpenTab);
  handlerRef.current = onOpenTab;
  const enabled = onOpenTab !== null;
  useEffect(() => {
    if (!isWeb || !enabled) return;
    const node = ref.current as unknown as HTMLElement | null;
    if (!node || typeof node.addEventListener !== "function") return;
    const listener = (event: MouseEvent) => {
      if (event.button !== 1) return;
      event.preventDefault();
      handlerRef.current?.();
    };
    node.addEventListener("auxclick", listener);
    return () => node.removeEventListener("auxclick", listener);
  }, [enabled, ref]);
}
