// Supabase Edge Function: dub-snap
//
// Flow:
//   1. App uploads video to Storage bucket "snaps"
//   2. App invokes this function with { path, targetLang, sourceLang }
//   3. Function downloads the file (service role), calls ElevenLabs, polls until done
//   4. Downloads FULL dubbed MP4, uploads to Storage, returns signed dubbedVideoUrl
//
// Secrets:
//   npx supabase secrets set ELEVENLABS_API_KEY=your_key
//
// Deploy:
//   npx supabase functions deploy dub-snap

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const ELEVEN_BASE = "https://api.elevenlabs.io/v1";
const MAX_POLL_ATTEMPTS = 24; // ~2 minutes (Edge Functions time out around ~150s)
const POLL_MS = 5000;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }

  if (req.method !== "POST") {
    return fail("Method not allowed", 405);
  }

  let step = "init";

  try {
    // ---- Env / secrets ----------------------------------------------------
    step = "check_env";
    // Trim whitespace/newlines — a leading space makes ElevenLabs reject the key
    // ("API keys start with sk_") even when the rest of the key is correct.
    const elevenKeyRaw = Deno.env.get("ELEVENLABS_API_KEY") ?? "";
    const elevenKey = elevenKeyRaw.trim();
    if (!elevenKey) {
      return fail(
        "Missing ELEVENLABS_API_KEY secret. Run: npx supabase secrets set ELEVENLABS_API_KEY=sk_...",
        500,
        { step },
      );
    }
    if (!elevenKey.startsWith("sk_")) {
      return fail(
        "ELEVENLABS_API_KEY on Supabase secrets is invalid. It must start with sk_ (not xi- or sb_). Update with: npx supabase secrets set ELEVENLABS_API_KEY=sk_...",
        500,
        {
          step,
          keyPrefix: elevenKey.slice(0, 4),
          keyLength: elevenKey.length,
          hint: "Changing server/.env does NOT update Edge Function secrets.",
        },
      );
    }
    console.log(
      JSON.stringify({
        step,
        elevenKeyPrefix: elevenKey.slice(0, 3),
        elevenKeyLength: elevenKey.length,
      }),
    );

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    if (!supabaseUrl || !serviceKey) {
      return fail("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY on Edge Function", 500, {
        step,
      });
    }

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return fail("Missing Authorization header — log in first", 401, { step });
    }

    // ---- Parse body -------------------------------------------------------
    step = "parse_body";
    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch (error) {
      return fail("Invalid JSON body", 400, {
        step,
        detail: errorMessage(error),
      });
    }

    const path = typeof body.path === "string" ? body.path : "";
    const targetLang =
      typeof body.targetLang === "string" && body.targetLang.trim()
        ? body.targetLang.trim()
        : "es";
    const sourceLang =
      typeof body.sourceLang === "string" && body.sourceLang.trim()
        ? body.sourceLang.trim()
        : "en";

    if (!path) {
      return fail("Missing storage path", 400, { step });
    }

    // ---- Auth user (JWT) --------------------------------------------------
    step = "auth_user";
    let userId: string | null = null;
    if (anonKey) {
      try {
        const userClient = createClient(supabaseUrl, anonKey, {
          global: { headers: { Authorization: authHeader } },
        });
        const { data: userData, error: userError } = await userClient.auth.getUser();
        if (userError) {
          return fail("Invalid or expired session", 401, {
            step,
            detail: userError.message,
          });
        }
        userId = userData.user?.id ?? null;
      } catch (error) {
        return fail("Failed to validate user session", 401, {
          step,
          detail: errorMessage(error),
        });
      }
    }

    if (userId && !path.startsWith(`${userId}/`)) {
      return fail("Storage path does not belong to the authenticated user", 403, {
        step,
        path,
        userId,
      });
    }

    // Service role bypasses Storage RLS for download + dubbed upload
    const admin = createClient(supabaseUrl, serviceKey);

    // ---- Download original from Storage -----------------------------------
    step = "storage_download";
    let fileData: Blob;
    try {
      const { data, error: downloadError } = await admin.storage
        .from("snaps")
        .download(path);

      if (downloadError || !data) {
        return fail(
          downloadError?.message || `Could not download snaps/${path}`,
          400,
          {
            step,
            path,
            hint:
              "Confirm the file exists in Storage → snaps and setup_snaps_storage.sql was run. Service role should bypass RLS.",
          },
        );
      }
      fileData = data;
    } catch (error) {
      return fail("Storage download threw", 500, {
        step,
        path,
        detail: errorMessage(error),
      });
    }

    const bytes = new Uint8Array(await fileData.arrayBuffer());
    if (bytes.byteLength === 0) {
      return fail("Downloaded snap is empty (0 bytes)", 400, { step, path });
    }

    const filename = path.split("/").pop() || "snap.mp4";
    console.log(
      JSON.stringify({
        step,
        path,
        filename,
        bytes: bytes.byteLength,
        targetLang,
        sourceLang,
      }),
    );

    // ---- Start ElevenLabs dubbing ----------------------------------------
    step = "elevenlabs_create";
    let dubbingId: string;
    try {
      const form = new FormData();
      // File is more reliable than Blob in Deno FormData for multipart uploads
      form.append(
        "file",
        new File([bytes], filename, { type: guessMime(filename) }),
      );
      form.append("name", `snap-${Date.now()}`);
      form.append("target_lang", targetLang);
      form.append("source_lang", sourceLang);
      form.append("num_speakers", "0");
      // Free-tier ElevenLabs accounts require watermarking
      form.append("watermark", "true");

      const createRes = await fetch(`${ELEVEN_BASE}/dubbing`, {
        method: "POST",
        headers: { "xi-api-key": elevenKey },
        body: form,
      });

      const createText = await createRes.text();
      let createJson: Record<string, unknown> | null = null;
      try {
        createJson = JSON.parse(createText);
      } catch {
        createJson = null;
      }

      if (!createRes.ok) {
        console.error("elevenlabs_create_failed", createRes.status, createText);
        return fail("ElevenLabs create failed", 502, {
          step,
          status: createRes.status,
          elevenLabs: createJson ?? createText,
        });
      }

      dubbingId =
        (createJson?.dubbing_id as string | undefined) ||
        (createJson?.dubbingId as string | undefined) ||
        "";

      if (!dubbingId) {
        return fail("ElevenLabs did not return dubbing_id", 502, {
          step,
          elevenLabs: createJson ?? createText,
        });
      }
    } catch (error) {
      return fail("ElevenLabs create request threw", 502, {
        step,
        detail: errorMessage(error),
      });
    }

    console.log(JSON.stringify({ step: "elevenlabs_started", dubbingId }));

    // ---- Poll until dubbed -----------------------------------------------
    step = "elevenlabs_poll";
    let status = "dubbing";
    let lastMeta: Record<string, unknown> | null = null;

    for (let i = 0; i < MAX_POLL_ATTEMPTS; i++) {
      await sleep(POLL_MS);

      try {
        const statusRes = await fetch(`${ELEVEN_BASE}/dubbing/${dubbingId}`, {
          headers: { "xi-api-key": elevenKey },
        });
        const statusText = await statusRes.text();
        let meta: Record<string, unknown> | null = null;
        try {
          meta = JSON.parse(statusText);
        } catch {
          meta = null;
        }

        if (!statusRes.ok) {
          console.error("elevenlabs_poll_failed", statusRes.status, statusText);
          // Keep polling on transient errors
          continue;
        }

        lastMeta = meta;
        status = String(meta?.status ?? "unknown");
        console.log(JSON.stringify({ step, attempt: i + 1, status, dubbingId }));

        if (status === "dubbed") break;
        if (status === "failed" || status === "error") {
          return fail(`ElevenLabs dubbing failed (${status})`, 502, {
            step,
            dubbingId,
            elevenLabs: meta,
          });
        }
      } catch (error) {
        console.error("elevenlabs_poll_threw", errorMessage(error));
        // Keep polling on transient network errors
      }
    }

    if (status !== "dubbed") {
      return fail("Dubbing timed out in Edge Function. Try a shorter clip.", 504, {
        step,
        dubbingId,
        status,
        elevenLabs: lastMeta,
      });
    }

    // ---- Download dubbed VIDEO (mp4) from ElevenLabs ---------------------
    // For video inputs, GET /dubbing/{id}/audio/{lang} streams an MP4 (or MP3).
    // We prefer MP4 and fall back to an explicit resource render if needed.
    step = "elevenlabs_video";
    let videoBytes: Uint8Array;
    let contentType = "video/mp4";

    try {
      const media = await fetchDubbedMedia({
        elevenKey,
        dubbingId,
        targetLang,
      });
      videoBytes = media.bytes;
      contentType = media.contentType;

      if (!isLikelyMp4(videoBytes, contentType)) {
        console.log(
          JSON.stringify({
            step,
            note: "Primary download was not mp4 — requesting resource render",
            contentType,
            bytes: videoBytes.byteLength,
          }),
        );

        const rendered = await renderAndDownloadMp4({
          elevenKey,
          dubbingId,
          targetLang,
        });
        if (rendered) {
          videoBytes = rendered.bytes;
          contentType = rendered.contentType;
        }
      }

      if (videoBytes.byteLength === 0) {
        return fail("ElevenLabs returned empty dubbed media", 502, {
          step,
          dubbingId,
        });
      }

      if (!isLikelyMp4(videoBytes, contentType)) {
        return fail(
          "ElevenLabs did not return an MP4 video. Got audio-only or unknown format.",
          502,
          {
            step,
            dubbingId,
            contentType,
            bytes: videoBytes.byteLength,
            hint: "Ensure the uploaded snap is a video (.mp4/.mov), not audio-only.",
          },
        );
      }
    } catch (error) {
      return fail("ElevenLabs video download threw", 502, {
        step,
        detail: errorMessage(error),
      });
    }

    // ---- Upload dubbed VIDEO (service role bypasses RLS) -----------------
    step = "storage_upload_dubbed";
    const folder = path.includes("/") ? path.split("/")[0] : userId ?? "anonymous";
    const dubbedPath = `${folder}/dubbed/${Date.now()}-${targetLang}.mp4`;

    try {
      const { error: uploadError } = await admin.storage
        .from("snaps")
        .upload(dubbedPath, videoBytes, {
          contentType: "video/mp4",
          upsert: false,
        });

      if (uploadError) {
        return fail("Failed to upload dubbed video to Storage", 500, {
          step,
          dubbedPath,
          detail: uploadError.message,
        });
      }
    } catch (error) {
      return fail("Storage upload threw", 500, {
        step,
        dubbedPath,
        detail: errorMessage(error),
      });
    }

    // Prefer a signed URL so playback works even if the bucket is private
    step = "storage_signed_url";
    let dubbedVideoUrl: string | null = null;
    try {
      const { data: signed, error: signedError } = await admin.storage
        .from("snaps")
        .createSignedUrl(dubbedPath, 60 * 60 * 24); // 24h

      if (signedError) {
        console.error("signed_url_failed", signedError.message);
      } else {
        dubbedVideoUrl = signed?.signedUrl ?? null;
      }
    } catch (error) {
      console.error("signed_url_threw", errorMessage(error));
    }

    if (!dubbedVideoUrl) {
      const { data: publicData } = admin.storage
        .from("snaps")
        .getPublicUrl(dubbedPath);
      dubbedVideoUrl = publicData.publicUrl;
    }

    return ok({
      dubbingId,
      targetLang,
      sourceLang,
      originalPath: path,
      dubbedPath,
      dubbedVideoUrl,
      // Back-compat alias if any old client still reads audioUrl
      audioUrl: dubbedVideoUrl,
      contentType,
      bytesIn: bytes.byteLength,
      bytesOut: videoBytes.byteLength,
    });
  } catch (error) {
    console.error("dub_snap_unhandled", step, error);
    return fail("Unhandled dub-snap error", 500, {
      step,
      detail: errorMessage(error),
    });
  }
});

async function fetchDubbedMedia({
  elevenKey,
  dubbingId,
  targetLang,
}: {
  elevenKey: string;
  dubbingId: string;
  targetLang: string;
}) {
  const audioRes = await fetch(
    `${ELEVEN_BASE}/dubbing/${dubbingId}/audio/${targetLang}`,
    {
      headers: {
        "xi-api-key": elevenKey,
        Accept: "video/mp4, application/octet-stream, */*",
      },
    },
  );

  if (!audioRes.ok) {
    const text = await audioRes.text();
    throw new Error(
      `Failed to fetch dubbed media (${audioRes.status}): ${text}`,
    );
  }

  const contentType = audioRes.headers.get("content-type") || "application/octet-stream";
  const buffer = await audioRes.arrayBuffer();
  return {
    bytes: new Uint8Array(buffer),
    contentType,
  };
}

/**
 * Ask ElevenLabs to render an explicit MP4, then download it.
 * POST /v1/dubbing/resource/{id}/render/{lang}  { render_type: "mp4" }
 */
async function renderAndDownloadMp4({
  elevenKey,
  dubbingId,
  targetLang,
}: {
  elevenKey: string;
  dubbingId: string;
  targetLang: string;
}): Promise<{ bytes: Uint8Array; contentType: string } | null> {
  try {
    const renderRes = await fetch(
      `${ELEVEN_BASE}/dubbing/resource/${dubbingId}/render/${targetLang}`,
      {
        method: "POST",
        headers: {
          "xi-api-key": elevenKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ render_type: "mp4" }),
      },
    );

    const renderText = await renderRes.text();
    if (!renderRes.ok) {
      console.error("elevenlabs_render_failed", renderRes.status, renderText);
      return null;
    }

    let renderJson: Record<string, unknown> | null = null;
    try {
      renderJson = JSON.parse(renderText);
    } catch {
      renderJson = null;
    }

    const renderId =
      (renderJson?.render_id as string | undefined) ||
      (renderJson?.renderId as string | undefined);

    // Poll resource until render is complete (best-effort, short window)
    for (let i = 0; i < 12; i++) {
      await sleep(5000);
      const resourceRes = await fetch(
        `${ELEVEN_BASE}/dubbing/resource/${dubbingId}`,
        { headers: { "xi-api-key": elevenKey } },
      );
      if (!resourceRes.ok) continue;

      const resource = await resourceRes.json();
      const renders = resource?.renders ?? {};
      const renderEntry = renderId
        ? renders[renderId]
        : Object.values(renders).find(
            (r: unknown) =>
              (r as { render_type?: string; renderType?: string })
                ?.render_type === "mp4" ||
              (r as { renderType?: string })?.renderType === "mp4",
          );

      const renderStatus = String(
        (renderEntry as { status?: string } | undefined)?.status ?? "",
      ).toLowerCase();

      if (renderStatus === "complete" || renderStatus === "completed" || renderStatus === "done") {
        // After render completes, the standard audio endpoint should return mp4
        return await fetchDubbedMedia({ elevenKey, dubbingId, targetLang });
      }
      if (renderStatus === "failed" || renderStatus === "error") {
        console.error("elevenlabs_render_status_failed", renderEntry);
        return null;
      }
    }
  } catch (error) {
    console.error("elevenlabs_render_threw", errorMessage(error));
  }
  return null;
}

function isLikelyMp4(bytes: Uint8Array, contentType: string) {
  const ct = (contentType || "").toLowerCase();
  if (ct.includes("mp4") || ct.includes("video")) return true;
  // ISO BMFF: bytes[4..7] === "ftyp"
  if (bytes.byteLength >= 8) {
    const ftyp = String.fromCharCode(
      bytes[4],
      bytes[5],
      bytes[6],
      bytes[7],
    );
    if (ftyp === "ftyp") return true;
  }
  return false;
}

function ok(body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { ...corsHeaders(), "Content-Type": "application/json" },
  });
}

function fail(
  error: string,
  status = 500,
  extra: Record<string, unknown> = {},
) {
  const payload = { error, status, ...extra };
  console.error("dub_snap_fail", JSON.stringify(payload));
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders(), "Content-Type": "application/json" },
  });
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function guessMime(filename: string) {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".mp3")) return "audio/mpeg";
  if (lower.endsWith(".mov")) return "video/quicktime";
  if (lower.endsWith(".wav")) return "audio/wav";
  if (lower.endsWith(".m4a")) return "audio/mp4";
  return "video/mp4";
}
