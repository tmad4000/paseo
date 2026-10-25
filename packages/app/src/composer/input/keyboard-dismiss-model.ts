/**
 * Visibility policy for the composer's keyboard-dismiss affordance.
 *
 * The control only makes sense while a software keyboard actually occupies
 * screen space. The settled keyboard shift is the app's authoritative signal
 * for that: it is zero when the keyboard is closed and when a hardware
 * keyboard has focus without an on-screen IME, so the button never appears in
 * either of those states.
 */
export function shouldShowKeyboardDismissButton(settledKeyboardShift: number): boolean {
  return settledKeyboardShift > 0;
}
