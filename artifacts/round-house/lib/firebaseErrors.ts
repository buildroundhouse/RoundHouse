export function firebaseErrorMessage(err: unknown): string {
  if (err && typeof err === "object" && "code" in err) {
    const code = String((err as { code: unknown }).code);
    const rawMessage =
      "message" in err && typeof (err as { message: unknown }).message === "string"
        ? (err as { message: string }).message
        : "";

    switch (code) {
      case "auth/cancelled-popup-request":
        return "";
      case "auth/invalid-email":
        return "That email address looks invalid.";
      case "auth/user-not-found":
        return "No account found with this email. Tap Sign up below to create one.";
      case "auth/wrong-password":
      case "auth/invalid-credential":
        return "Incorrect email or password.";
      case "auth/email-already-in-use":
        return "An account with this email already exists. Try signing in instead.";
      case "auth/weak-password":
        return "Password is too weak. Use at least 6 characters.";
      case "auth/too-many-requests":
        return "Too many attempts. Please wait a moment and try again.";
      case "auth/network-request-failed":
        return "Network error. Check your connection and try again.";
      case "auth/operation-not-allowed":
        return "Email/Password sign-in isn't enabled in your Firebase project. Enable it in Authentication → Sign-in method.";
      case "auth/popup-blocked":
        return "Popup was blocked by the browser. Allow popups and try again.";
      case "auth/popup-closed-by-user":
        return "Sign-in window was closed before completion.";
      case "auth/unauthorized-domain":
        return "This domain isn't authorized in Firebase. Add it under Authentication → Settings → Authorized domains.";
      case "auth/api-key-not-valid":
      case "auth/invalid-api-key":
        return "Firebase API key is invalid. Double-check EXPO_PUBLIC_FIREBASE_API_KEY.";
      default:
        return rawMessage ? `${rawMessage} (${code})` : `Sign-in failed (${code}).`;
    }
  }
  if (err instanceof Error) return err.message;
  return "Something went wrong. Please try again.";
}
