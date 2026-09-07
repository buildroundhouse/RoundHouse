import { Alert, Platform } from "react-native";

/**
 * Cross-platform destructive-confirmation helper.
 *
 * React Native Web ships `Alert.alert` as a no-op stub, which means
 * any confirmation dialog built on top of it silently does nothing in
 * the web build. This helper picks the right primitive per platform —
 * `window.confirm` on web, `Alert.alert` on native — so a single call
 * site works the same way in both worlds.
 *
 * Always returns a Promise that resolves to `true` if the user
 * confirmed and `false` if they cancelled or dismissed the dialog.
 */
export type ConfirmOptions = {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
};

export function confirm(opts: ConfirmOptions): Promise<boolean> {
  const {
    title,
    message = "",
    confirmLabel = "OK",
    cancelLabel = "Cancel",
    destructive = false,
  } = opts;

  if (Platform.OS === "web") {
    const text = message ? `${title}\n\n${message}` : title;
    // Safe-by-default: if no confirm primitive is available (non-browser
    // web runtime, jsdom without confirm shim, etc.) we treat it as a
    // cancellation rather than auto-confirming a destructive action.
    const ok =
      typeof globalThis !== "undefined" &&
      typeof globalThis.confirm === "function"
        ? globalThis.confirm(text)
        : false;
    return Promise.resolve(ok);
  }

  return new Promise((resolve) => {
    Alert.alert(
      title,
      message,
      [
        {
          text: cancelLabel,
          style: "cancel",
          onPress: () => resolve(false),
        },
        {
          text: confirmLabel,
          style: destructive ? "destructive" : "default",
          onPress: () => resolve(true),
        },
      ],
      { onDismiss: () => resolve(false) },
    );
  });
}
