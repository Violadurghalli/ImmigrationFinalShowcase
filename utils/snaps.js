/**
 * Upload recorded snaps to Supabase Storage (bucket: "snaps").
 * Create the bucket + policies with supabase/sql/setup_snaps_storage.sql
 */

import { FunctionsHttpError } from "@supabase/supabase-js";
import { supabase } from "./hooks/supabase";

function extForCapture(type, uri) {
  if (type === "photo") return "jpg";
  const lower = (uri || "").toLowerCase();
  if (lower.includes(".mov")) return "mov";
  return "mp4";
}

function contentTypeForExt(ext) {
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "mov") return "video/quicktime";
  if (ext === "mp3") return "audio/mpeg";
  return "video/mp4";
}

/**
 * @param {{ type: 'photo' | 'video', uri: string }} capture
 * @returns {Promise<{ path: string, publicUrl: string | null }>}
 */
export async function uploadSnap(capture) {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user?.id) {
    throw new Error("You must be logged in to upload snaps to Supabase.");
  }

  const owner = user.id;
  const ext = extForCapture(capture.type, capture.uri);
  const path = `${owner}/${Date.now()}.${ext}`;

  const response = await fetch(capture.uri);
  const arrayBuffer = await response.arrayBuffer();

  if (!arrayBuffer || arrayBuffer.byteLength === 0) {
    throw new Error("Local snap file is empty — record again before uploading.");
  }

  const { error } = await supabase.storage.from("snaps").upload(path, arrayBuffer, {
    contentType: contentTypeForExt(ext),
    upsert: false,
  });

  if (error) {
    throw new Error(error.message || "Failed to upload snap to Supabase Storage");
  }

  const { data } = supabase.storage.from("snaps").getPublicUrl(path);

  return {
    path,
    publicUrl: data?.publicUrl ?? null,
  };
}

/**
 * Ask the dub-snap Edge Function to dub a file already in Storage.
 * Expects a full dubbed MP4 back via `dubbedVideoUrl`.
 * Surfaces the real JSON error body from non-2xx responses.
 */
export async function requestDub({ path, targetLang = "es", sourceLang = "en" }) {
  const { data, error } = await supabase.functions.invoke("dub-snap", {
    body: { path, targetLang, sourceLang },
  });

  if (error) {
    throw new Error(await formatFunctionsError(error));
  }

  if (data?.error) {
    throw new Error(formatDubPayloadError(data));
  }

  const dubbedVideoUrl = data?.dubbedVideoUrl || data?.audioUrl;
  if (!dubbedVideoUrl) {
    throw new Error("Edge function did not return dubbedVideoUrl");
  }

  return {
    ...data,
    dubbedVideoUrl,
  };
}

async function formatFunctionsError(error) {
  // supabase-js hides the body behind FunctionsHttpError.context
  if (error instanceof FunctionsHttpError) {
    try {
      const payload = await error.context.json();
      return formatDubPayloadError(payload) || error.message;
    } catch {
      try {
        const text = await error.context.text();
        if (text) return text;
      } catch {
        // fall through
      }
    }
  }

  return error?.message || "Edge function dub-snap failed";
}

function formatDubPayloadError(payload) {
  if (!payload || typeof payload !== "object") return String(payload ?? "");

  const parts = [];
  if (payload.error) parts.push(String(payload.error));
  if (payload.step) parts.push(`step=${payload.step}`);
  if (payload.detail) parts.push(`detail=${payload.detail}`);
  if (payload.status && payload.status !== 500) {
    parts.push(`http=${payload.status}`);
  }
  if (payload.elevenLabs) {
    parts.push(
      `elevenLabs=${
        typeof payload.elevenLabs === "string"
          ? payload.elevenLabs
          : JSON.stringify(payload.elevenLabs)
      }`,
    );
  }
  if (payload.hint) parts.push(payload.hint);

  return parts.join(" | ") || JSON.stringify(payload);
}
