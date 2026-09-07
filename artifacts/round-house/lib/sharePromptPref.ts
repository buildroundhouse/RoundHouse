export const SHARE_PROMPT_SKIP_KEY = "roundhouse:share-photos:skip-prompt";
export const SHARE_PROMPT_LAST_NOTE_KEY = "roundhouse:share-photos:last-note";

export function extractCustomNote(
  finalMessage: string,
  defaultMessage: string
): string {
  const msg = finalMessage.trim();
  const def = defaultMessage.trim();
  if (!msg) return "";
  if (def && msg === def) return "";
  if (def && msg.startsWith(def)) {
    return msg.slice(def.length).replace(/^[\s·•\-–—,:|]+/, "").trim();
  }
  if (def && msg.endsWith(def)) {
    return msg.slice(0, msg.length - def.length).replace(/[\s·•\-–—,:|]+$/, "").trim();
  }
  return msg;
}
