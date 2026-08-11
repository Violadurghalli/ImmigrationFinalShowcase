/**
 * Client for the local ElevenLabs dubbing server (server/).
 *
 * Architecture:
 *   Expo app  --multipart video-->  Express server  -->  ElevenLabs Dubbing API
 *   Expo app  <--audio URL---------  Express server  <--  polled dubbed audio
 *
 * Never put ELEVENLABS_API_KEY in the app. Only the server has it.
 */

const DEFAULT_BASE_URL = "http://localhost:3001";

function getBaseUrl() {
  return process.env.EXPO_PUBLIC_DUBBING_API_URL || DEFAULT_BASE_URL;
}

/**
 * Upload a recorded snap (local file URI) and dub it into targetLang.
 * @param {string} localUri - file:// URI from expo-camera recordAsync
 * @param {{ targetLang?: string, sourceLang?: string }} options
 * @returns {Promise<{ dubbingId: string, targetLang: string, audioUrl: string }>}
 */
export async function dubLocalVideo(localUri, options = {}) {
  const targetLang = options.targetLang || "es";
  const sourceLang = options.sourceLang || "en";
  const baseUrl = getBaseUrl().replace(/\/$/, "");

  // Fail fast with a clear message if the phone can't reach the Mac
  try {
    const health = await fetch(`${baseUrl}/health`);
    if (!health.ok) {
      throw new Error(`Dubbing server health check failed (${health.status})`);
    }
  } catch (error) {
    throw new Error(
      `Cannot reach dubbing server at ${baseUrl}. ` +
        `On a phone, localhost won't work — use your Mac LAN IP in EXPO_PUBLIC_DUBBING_API_URL, ` +
        `restart Expo with -c, and keep \`npm run dubbing-server\` running. ` +
        `(${error instanceof Error ? error.message : "network error"})`,
    );
  }

  const formData = new FormData();
  formData.append("file", {
    uri: localUri,
    type: "video/mp4",
    name: "snap.mp4",
  });
  formData.append("targetLang", targetLang);
  formData.append("sourceLang", sourceLang);

  const response = await fetch(`${baseUrl}/dub`, {
    method: "POST",
    body: formData,
    // Do not set Content-Type — RN sets multipart boundary automatically
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || `Dubbing request failed (${response.status})`);
  }

  return {
    dubbingId: payload.dubbingId,
    targetLang: payload.targetLang,
    // Absolute URL the app can play / download
    audioUrl: `${baseUrl}${payload.audioUrl}`,
  };
}

export async function checkDubbingServer() {
  const baseUrl = getBaseUrl().replace(/\/$/, "");
  const response = await fetch(`${baseUrl}/health`);
  if (!response.ok) throw new Error("Dubbing server not reachable");
  return response.json();
}
