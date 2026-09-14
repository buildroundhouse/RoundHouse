export function getApiBaseUrl(): string {
  if (typeof window !== "undefined") {
    const { protocol, hostname } = window.location;
    if (hostname.endsWith(".app.github.dev")) {
      const apiHost = hostname.replace(/-\d+\.app\.github\.dev$/, "-3001.app.github.dev");
      return `${protocol}//${apiHost}`.replace(/\/+$/, "");
    }
  }

  return (process.env.EXPO_PUBLIC_API_URL ?? "").trim().replace(/\/+$/, "");
}
