import "dotenv/config";
import express from "express";
import cors from "cors";
import multer from "multer";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { dubFile } from "./dubbing.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const UPLOAD_DIR = path.join(ROOT, "tmp", "uploads");
const OUTPUT_DIR = path.join(ROOT, "tmp", "dubbed");

fs.mkdirSync(UPLOAD_DIR, { recursive: true });
fs.mkdirSync(OUTPUT_DIR, { recursive: true });

const upload = multer({ dest: UPLOAD_DIR });
const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use("/dubbed", express.static(OUTPUT_DIR));

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    hasApiKey: Boolean(process.env.ELEVENLABS_API_KEY),
  });
});

/**
 * POST /dub
 * multipart form fields:
 *   - file: audio or video (from Expo camera)
 *   - targetLang: e.g. "es" (default)
 *   - sourceLang: e.g. "en" (default)
 *
 * Response:
 *   { dubbingId, targetLang, audioUrl }
 */
app.post("/dub", upload.single("file"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "Missing file upload (field name: file)" });
  }

  const targetLang = (req.body.targetLang || "es").trim();
  const sourceLang = (req.body.sourceLang || "en").trim();
  const uploadPath = req.file.path;
  const outputName = `${Date.now()}-${targetLang}.mp3`;
  const outputPath = path.join(OUTPUT_DIR, outputName);

  try {
    const result = await dubFile({
      filePath: uploadPath,
      targetLang,
      sourceLang,
      outputPath,
    });

    res.json({
      dubbingId: result.dubbingId,
      targetLang: result.targetLang,
      audioUrl: `/dubbed/${outputName}`,
    });
  } catch (error) {
    console.error("[dub] failed:", error);
    res.status(500).json({
      error: error.message || "Dubbing failed",
    });
  } finally {
    fs.unlink(uploadPath, () => {});
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Dubbing server listening on http://0.0.0.0:${PORT}`);
  console.log(`From this Mac:     http://localhost:${PORT}`);
  console.log(`From your phone:   http://<your-mac-lan-ip>:${PORT}`);
  console.log(
    process.env.ELEVENLABS_API_KEY
      ? "ELEVENLABS_API_KEY loaded"
      : "WARNING: ELEVENLABS_API_KEY is missing — copy server/.env.example to server/.env",
  );
});
