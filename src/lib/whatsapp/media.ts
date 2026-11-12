/**
 * What WhatsApp accepts as an attachment, and how we label it in the thread.
 * Pure (no network), shared by the upload route, the send route and the UI.
 *
 * WhatsApp's own limits: photos (JPEG/PNG) 5 MB, videos (MP4/3GP) and audio
 * 16 MB, documents 100 MB — capped here at 20 MB, the storage bucket's limit.
 * Any other image type (HEIC, WebP, GIF) goes as a document so it still arrives.
 */

export type WaMediaKind = "image" | "video" | "audio" | "document";

const MB = 1024 * 1024;
const IMAGE = ["image/jpeg", "image/png"];
const VIDEO = ["video/mp4", "video/3gpp"];
const AUDIO = ["audio/aac", "audio/mp4", "audio/mpeg", "audio/amr", "audio/ogg", "audio/mp3", "audio/x-m4a", "audio/m4a"];

export const LIMIT: Record<WaMediaKind, number> = { image: 5 * MB, video: 16 * MB, audio: 16 * MB, document: 20 * MB };

export const LABEL: Record<WaMediaKind, string> = {
  image: "📷 Photo",
  video: "🎥 Video",
  audio: "🎤 Voice message",
  document: "📎 Document",
};

/** The file types offered in the browser's file picker. */
export const ACCEPT = [...IMAGE, ...VIDEO, ...AUDIO, "image/*", "application/pdf", ".doc", ".docx", ".xls", ".xlsx", ".csv", ".txt", ".ppt", ".pptx"].join(",");

export function mediaKind(type: string): WaMediaKind {
  const t = (type || "").split(";")[0].trim().toLowerCase();
  if (IMAGE.includes(t)) return "image";
  if (VIDEO.includes(t)) return "video";
  if (AUDIO.includes(t)) return "audio";
  return "document";
}

/** null when the file can be sent, otherwise the reason in plain words. */
export function checkAttachment(file: { name: string; type: string; size: number }): string | null {
  if (!file.name || !file.size) return "That file is empty.";
  const kind = mediaKind(file.type);
  if (file.size > LIMIT[kind]) {
    const what = kind === "image" ? "Photos" : kind === "document" ? "Files" : kind === "video" ? "Videos" : "Audio files";
    return `${what} can be up to ${LIMIT[kind] / MB} MB on WhatsApp. This one is ${(file.size / MB).toFixed(1)} MB.`;
  }
  return null;
}

/** The thread body for a sent attachment, matching how received ones are written. */
export function attachmentBody(kind: WaMediaKind, fileName: string, caption: string): string {
  const head = kind === "document" ? `${LABEL.document} (${fileName})` : LABEL[kind];
  return caption ? `${head}\n${caption}` : head;
}

/** A storage-safe file name. */
export function safeFileName(name: string): string {
  const cleaned = name.replace(/[^\w.\- ]+/g, "").replace(/\.{2,}/g, ".").replace(/^[.\s]+/, "").replace(/\s+/g, " ").trim().slice(0, 120);
  return cleaned || "file";
}
