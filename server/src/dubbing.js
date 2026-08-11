import fs from "fs";
import path from "path";
import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";

/**
 * Upload a local audio/video file to ElevenLabs Dubbing API,
 * poll until finished, then write the dubbed audio to disk.
 *
 * Mirrors the official dubbing quickstart, adapted for our server.
 */
export async function dubFile({
  filePath,
  targetLang = "es",
  sourceLang = "en",
  outputPath,
}) {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    throw new Error("Missing ELEVENLABS_API_KEY in server/.env");
  }

  const elevenlabs = new ElevenLabsClient({ apiKey });

  const fileBuffer = fs.readFileSync(filePath);
  const blob = new Blob([fileBuffer], {
    type: guessMimeType(filePath),
  });

  // Start dubbing job (same pattern as ElevenLabs quickstart)
  const dubbed = await elevenlabs.dubbing.create({
    file: blob,
    targetLang,
    sourceLang,
  });

  const dubbingId = dubbed.dubbingId;
  console.log(`[dubbing] started job ${dubbingId} → ${targetLang}`);

  // Poll until status is "dubbed"
  while (true) {
    const { status } = await elevenlabs.dubbing.get(dubbingId);
    console.log(`[dubbing] ${dubbingId} status: ${status}`);

    if (status === "dubbed") {
      const dubbedFile = await elevenlabs.dubbing.audio.get(
        dubbingId,
        targetLang,
      );

      const bytes = await streamToBuffer(dubbedFile);
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      fs.writeFileSync(outputPath, bytes);

      return { dubbingId, outputPath, targetLang };
    }

    if (status === "failed" || status === "error") {
      throw new Error(`ElevenLabs dubbing failed (status: ${status})`);
    }

    await sleep(5000);
  }
}

function guessMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".mp3") return "audio/mpeg";
  if (ext === ".wav") return "audio/wav";
  if (ext === ".m4a") return "audio/mp4";
  if (ext === ".mov") return "video/quicktime";
  return "video/mp4";
}

async function streamToBuffer(data) {
  // SDK may return a ReadableStream, Blob, Buffer, or ArrayBuffer
  if (Buffer.isBuffer(data)) return data;
  if (data instanceof ArrayBuffer) return Buffer.from(data);
  if (typeof data?.arrayBuffer === "function") {
    return Buffer.from(await data.arrayBuffer());
  }
  if (typeof data?.getReader === "function") {
    const reader = data.getReader();
    const chunks = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks);
  }
  // Node readable stream
  if (typeof data?.on === "function") {
    return await new Promise((resolve, reject) => {
      const chunks = [];
      data.on("data", (c) => chunks.push(Buffer.from(c)));
      data.on("end", () => resolve(Buffer.concat(chunks)));
      data.on("error", reject);
    });
  }
  throw new Error("Unexpected dubbed audio response type from ElevenLabs SDK");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
