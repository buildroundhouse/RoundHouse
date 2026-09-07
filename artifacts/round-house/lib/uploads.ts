import { Platform } from "react-native";
import { requestUploadUrl } from "@workspace/api-client-react";

export type UploadedAsset = {
  path: string;
  name: string;
  contentType: string;
  size: number;
};

const baseUrl = (process.env.EXPO_PUBLIC_DOMAIN ? `https://${process.env.EXPO_PUBLIC_DOMAIN}` : "").replace(/\/+$/, "");

export function resolveStorageUrl(
  path: string | null | undefined,
  bust?: string | number | Date | null,
): string | null {
  if (!path) return null;
  const isAbsolute = /^https?:\/\//.test(path);
  const normalized = isAbsolute ? path : path.startsWith("/") ? path : `/${path}`;
  const apiPath = isAbsolute
    ? normalized
    : normalized.startsWith("/objects/")
    ? `/api/storage${normalized}`
    : normalized.startsWith("/public-objects/")
    ? `/api/storage${normalized}`
    : normalized;
  const url = isAbsolute ? apiPath : `${baseUrl}${apiPath}`;
  if (bust == null || bust === "") return url;
  // Stable per-version cache key. We use this for profile media (avatar /
  // banner / company logo) so an updated profile image is fetched fresh
  // even if the React Native <Image> cache holds a previous response for
  // the same URL (e.g. an earlier 401 from before the public-profile-media
  // route shipped).
  const v = bust instanceof Date ? bust.getTime() : String(bust);
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}v=${encodeURIComponent(v)}`;
}

async function readFileAsBlob(uri: string): Promise<Blob> {
  if (Platform.OS === "web") {
    const r = await fetch(uri);
    return await r.blob();
  }
  const r = await fetch(uri);
  return await r.blob();
}

function guessContentType(name: string, fallback?: string): string {
  if (fallback && fallback !== "application/octet-stream") return fallback;
  const ext = name.split(".").pop()?.toLowerCase() || "";
  const map: Record<string, string> = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    gif: "image/gif",
    webp: "image/webp",
    heic: "image/heic",
    pdf: "application/pdf",
    txt: "text/plain",
    doc: "application/msword",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  };
  return map[ext] || fallback || "application/octet-stream";
}

export async function uploadAsset(input: {
  uri: string;
  name?: string | null;
  contentType?: string | null;
  size?: number | null;
}): Promise<UploadedAsset> {
  const blob = await readFileAsBlob(input.uri);
  const size = input.size ?? blob.size ?? 0;
  if (!size) throw new Error("Cannot upload empty file");
  const name = input.name || input.uri.split("/").pop() || "upload";
  const contentType = guessContentType(name, input.contentType ?? blob.type ?? undefined);

  const presigned = await requestUploadUrl({ name, size, contentType });

  const putResponse = await fetch(presigned.uploadURL, {
    method: "PUT",
    headers: { "Content-Type": contentType },
    body: blob,
  });
  if (!putResponse.ok) {
    throw new Error(`Upload failed (${putResponse.status})`);
  }

  return {
    path: presigned.objectPath,
    name,
    contentType,
    size,
  };
}
