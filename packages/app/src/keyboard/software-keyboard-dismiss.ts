import { Keyboard, TextInput } from "react-native";

/**
 * Put the software keyboard away without losing composer state.
 *
 * Keep blur and dismiss paired: this exact sequence was validated on a
 * physical Android device to clear both input focus and the IME inset. The
 * chat history's flick-to-dismiss gesture and the composer's dismiss button
 * share it so the two paths cannot drift apart.
 */
export function dismissSoftwareKeyboard() {
  const focusedInput = TextInput.State.currentlyFocusedInput();
  if (focusedInput) {
    TextInput.State.blurTextInput(focusedInput);
  }
  Keyboard.dismiss();
}
