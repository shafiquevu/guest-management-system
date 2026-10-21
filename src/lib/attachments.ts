import "server-only";

import { parseMessage } from "@/lib/format";
import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * Airbnb photo links (sent through Beds24) expire one hour after the message.
 * As soon as a message with photos is synced, each photo is copied into the
 * private Supabase Storage bucket below and recorded in message_attachments,
 * so staff can still see it next week. Staff get short-lived signed links.
 */

export const BUCKET = "message-attachments";

let bucketReady = false;
async function ensureBucket() {
  if (bucketReady) return;
  const db = supabaseAdmin();
  const { data } = await db.storage.getBucket(BUCKET);
  if (!data) {
    const { error } = await db.storage.createBucket(BUCKET, { public: false, fileSizeLimit: "20MB" });
    if (error && !/exists/i.test(error.message)) throw new Error(`storage: ${error.message}`);
  }
  bucketReady = true;
}

const EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif", "image/heic": "heic" };

/** Copy the photos in these messages into storage. Never throws: a photo that cannot be fetched is skipped. */
export async function savePhotos(orgId: string, messages: { id: string; body: string | null }[]): Promise<number> {
  const withPhotos = messages.map((m) => ({ ...m, images: parseMessage(m.body).images })).filter((m) => m.images.length);
  if (!withPhotos.length) return 0;

  const db = supabaseAdmin();
  let saved = 0;
  try {
    await ensureBucket();
    const { data: existing } = await db
      .from("message_attachments")
      .select("message_id")
      .in("message_id", withPhotos.map((m) => m.id));
    const done = new Set((existing ?? []).map((a) => a.message_id as string));

    for (const m of withPhotos) {
      if (done.has(m.id)) continue;
      for (const [i, img] of m.images.entries()) {
        try {
          const res = await fetch(img.src);
          const type = (res.headers.get("content-type") ?? "").split(";")[0];
          if (!res.ok || !type.startsWith("image/")) continue;
          const bytes = new Uint8Array(await res.arrayBuffer());
          const name = `photo-${i + 1}.${EXT[type] ?? "jpg"}`;
          const path = `${orgId}/${m.id}/${name}`;
          const { error } = await db.storage.from(BUCKET).upload(path, bytes, { contentType: type, upsert: true });
          if (error) continue;
          await db.from("message_attachments").insert({
            organization_id: orgId,
            message_id: m.id,
            file_name: name,
            file_type: type,
            file_size: bytes.byteLength,
            storage_path: path,
            external_url: img.href,
          });
          saved++;
        } catch {
          // expired or unreachable: the UI falls back to the original link
        }
      }
    }
  } catch (e) {
    console.error("savePhotos", e);
  }
  return saved;
}
