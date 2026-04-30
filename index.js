const express = require("express");
const multer = require("multer");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execFile } = require("child_process");
const ffmpegPath = require("ffmpeg-static");
const ffprobePath = require("ffprobe-static").path;

const app = express();
const PORT = process.env.PORT || 3000;
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;

app.set("trust proxy", true);

const UPLOADS_DIR = path.join(__dirname, "uploads");
const OUTPUT_DIR = path.join(__dirname, "output");
fs.mkdirSync(UPLOADS_DIR, { recursive: true });
fs.mkdirSync(OUTPUT_DIR, { recursive: true });

app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use("/output", express.static(OUTPUT_DIR));

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
  filename: (_req, file, cb) => {
    const safeExt = (path.extname(file.originalname || "") || ".jpg").toLowerCase();
    cb(null, `${Date.now()}-${crypto.randomBytes(6).toString("hex")}${safeExt}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024, files: 50 },
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype.startsWith("image/")) return cb(new Error("Only image uploads are allowed"));
    cb(null, true);
  },
});

const VOICES = {
  female: "EXAVITQu4vr4xnSDxMaL", // Sarah
  male: "CwhRBWXzGAHq8TQ4Fs17",   // Roger
};

const TONE_SETTINGS = {
  storytelling: { stability: 0.48, similarity_boost: 0.78, style: 0.42, speed: 1.0 },
  cinematic: { stability: 0.42, similarity_boost: 0.8, style: 0.7, speed: 0.94 },
  energetic: { stability: 0.36, similarity_boost: 0.72, style: 0.62, speed: 1.08 },
  dramatic: { stability: 0.34, similarity_boost: 0.82, style: 0.82, speed: 0.92 },
};

function run(cmd, args, label) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { maxBuffer: 1024 * 1024 * 20 }, (error, stdout, stderr) => {
      if (error) {
        const detail = (stderr || stdout || error.message || "").toString().slice(-4000);
        reject(new Error(`${label} failed: ${detail}`));
      } else {
        resolve(stdout);
      }
    });
  });
}

async function getDuration(filePath) {
  const stdout = await run(ffprobePath, [
    "-v", "error",
    "-show_entries", "format=duration",
    "-of", "default=noprint_wrappers=1:nokey=1",
    filePath,
  ], "ffprobe duration");
  const duration = Number.parseFloat(String(stdout).trim());
  if (!Number.isFinite(duration) || duration <= 0) throw new Error(`Could not read duration for ${path.basename(filePath)}`);
  return duration;
}

function parseTimeToSeconds(value) {
  const text = String(value).trim();
  if (!text) return null;
  if (/^\d+(\.\d+)?s?$/i.test(text)) return Number.parseFloat(text);
  const parts = text.split(":").map(Number);
  if (parts.some((n) => !Number.isFinite(n))) return null;
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return null;
}

function stripPanelPrefix(text) {
  return text.replace(/^\s*(panel|scene)\s*\d+\s*[:.)-]\s*/i, "").trim();
}

function parseScriptBlocks(script) {
  return String(script || "")
    .split(/\r?\n/)
    .map((raw) => raw.trim())
    .filter(Boolean)
    .map((raw, index) => {
      let text = raw;
      let targetDuration = null;

      const range = text.match(/^\[?\s*(\d+(?::\d{1,2}){0,2}(?:\.\d+)?s?)\s*(?:-->|-|to)\s*(\d+(?::\d{1,2}){0,2}(?:\.\d+)?s?)\s*\]?\s*(.*)$/i);
      if (range) {
        const start = parseTimeToSeconds(range[1]);
        const end = parseTimeToSeconds(range[2]);
        if (start !== null && end !== null && end > start) targetDuration = end - start;
        text = range[3].trim();
      }

      const durationTag = text.match(/^\[\s*(\d+(?:\.\d+)?)\s*s(?:ec(?:onds?)?)?\s*\]\s*(.*)$/i);
      if (durationTag) {
        targetDuration = Number.parseFloat(durationTag[1]);
        text = durationTag[2].trim();
      }

      text = stripPanelPrefix(text);
      if (!text) throw new Error(`Panel ${index + 1} narration is empty`);
      if (targetDuration !== null && (targetDuration < 1 || targetDuration > 60)) {
        throw new Error(`Panel ${index + 1} duration must be between 1 and 60 seconds`);
      }
      return { text, targetDuration };
    });
}

function atempoFilters(tempo) {
  const filters = [];
  let value = tempo;
  while (value > 2.0) {
    filters.push("atempo=2.0");
    value /= 2.0;
  }
  while (value < 0.5) {
    filters.push("atempo=0.5");
    value /= 0.5;
  }
  filters.push(`atempo=${value.toFixed(4)}`);
  return filters;
}

async function synthesizeNarration({ text, voiceGender, language, tone, outPath }) {
  if (!ELEVENLABS_API_KEY) {
    throw new Error("ELEVENLABS_API_KEY is missing on Railway. Add it in Railway → Variables, then redeploy.");
  }

  const voiceId = VOICES[voiceGender] || VOICES.female;
  const settings = TONE_SETTINGS[tone] || TONE_SETTINGS.storytelling;
  const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`, {
    method: "POST",
    headers: {
      "xi-api-key": ELEVENLABS_API_KEY,
      "Content-Type": "application/json",
      "Accept": "audio/mpeg",
    },
    body: JSON.stringify({
      text,
      model_id: "eleven_multilingual_v2",
      language_code: language,
      voice_settings: {
        stability: settings.stability,
        similarity_boost: settings.similarity_boost,
        style: settings.style,
        use_speaker_boost: true,
        speed: settings.speed,
      },
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`ElevenLabs TTS failed [${response.status}]: ${body.slice(0, 1000)}`);
  }

  const audio = Buffer.from(await response.arrayBuffer());
  if (audio.length < 1000) throw new Error("ElevenLabs returned empty audio");
  fs.writeFileSync(outPath, audio);
}

async function withRetry(task, attempts = 3) {
  let lastError;
  for (let i = 1; i <= attempts; i++) {
    try {
      return await task(i);
    } catch (err) {
      lastError = err;
      if (i < attempts) await new Promise((r) => setTimeout(r, 700 * i));
    }
  }
  throw lastError;
}

async function fitAudioToDuration(inputPath, outputPath, targetDuration) {
  const sourceDuration = await getDuration(inputPath);
  const tempo = sourceDuration / targetDuration;
  const filters = [
    ...atempoFilters(Math.min(2.5, Math.max(0.4, tempo))),
    "apad",
    `atrim=duration=${targetDuration.toFixed(3)}`,
    "asetpts=PTS-STARTPTS",
  ].join(",");

  await run(ffmpegPath, [
    "-y",
    "-i", inputPath,
    "-af", filters,
    "-ar", "44100",
    "-ac", "2",
    "-c:a", "libmp3lame",
    "-b:a", "128k",
    outputPath,
  ], "audio timing sync");
  return targetDuration;
}

function assTime(seconds) {
  const cs = Math.max(0, Math.round(seconds * 100));
  const h = Math.floor(cs / 360000);
  const m = Math.floor((cs % 360000) / 6000);
  const s = Math.floor((cs % 6000) / 100);
  const c = cs % 100;
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(c).padStart(2, "0")}`;
}

function escapeAss(text) {
  return text.replace(/\\/g, "\\\\").replace(/\{/g, "\\{").replace(/\}/g, "\\}").replace(/\r?\n/g, " ");
}

function buildSubtitles(panels, outPath) {
  let cursor = 0;
  const header = `[Script Info]\nScriptType: v4.00+\nPlayResX: 1280\nPlayResY: 720\nWrapStyle: 2\nScaledBorderAndShadow: yes\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: WordSync,Arial,38,&H00FFFFFF,&H003CF2FF,&H00111111,&H99000000,-1,0,0,0,100,100,0,0,1,3,1,2,70,70,46,1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n`;

  const events = panels.map((panel) => {
    const words = panel.text.split(/\s+/).filter(Boolean);
    const weights = words.map((w) => Math.max(1, w.replace(/[^\p{L}\p{N}]/gu, "").length));
    const total = weights.reduce((a, b) => a + b, 0) || words.length || 1;
    let used = 0;
    const karaoke = words.map((word, i) => {
      const remaining = Math.max(0, Math.round(panel.duration * 100) - used);
      const k = i === words.length - 1 ? remaining : Math.max(8, Math.round((panel.duration * 100 * weights[i]) / total));
      used += k;
      return `{\\k${k}}${escapeAss(word)}`;
    }).join(" ");
    const start = cursor;
    const end = cursor + panel.duration;
    cursor = end;
    return `Dialogue: 0,${assTime(start)},${assTime(end)},WordSync,,0,0,0,,${karaoke}`;
  });

  fs.writeFileSync(outPath, header + events.join("\n") + "\n");
}

function escapeSubtitlePath(filePath) {
  return filePath.replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "\\'");
}

async function createSegment({ imagePath, audioPath, duration, outPath }) {
  await run(ffmpegPath, [
    "-y",
    "-loop", "1",
    "-t", duration.toFixed(3),
    "-i", imagePath,
    "-i", audioPath,
    "-vf", "scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2:color=black,format=yuv420p,fps=30",
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-pix_fmt", "yuv420p",
    "-c:a", "aac",
    "-b:a", "192k",
    "-ar", "44100",
    "-shortest",
    outPath,
  ], "panel render");
}

function safeConcatLine(filePath) {
  return `file '${filePath.replace(/'/g, "'\\''")}'`;
}

app.get("/", (_req, res) => {
  res.json({ ok: true, service: "video-server", features: ["elevenlabs-tts", "panel-sync", "subtitles"] });
});

app.post("/generate-video", upload.array("images", 50), async (req, res) => {
  const cleanup = [];
  try {
    const files = req.files || [];
    const panels = parseScriptBlocks(req.body.narration || "");
    const voiceGender = String(req.body.voiceGender || "female").toLowerCase();
    const language = String(req.body.language || "en").toLowerCase();
    const tone = String(req.body.tone || "storytelling").toLowerCase();

    if (!ffmpegPath || !ffprobePath) throw new Error("FFmpeg binaries are not installed. Run npm install and redeploy.");
    if (!files.length) return res.status(400).json({ error: "No images uploaded" });
    if (!panels.length) return res.status(400).json({ error: "No narration blocks found" });
    if (files.length !== panels.length) {
      return res.status(400).json({
        error: "Panel count mismatch",
        detail: `Uploaded ${files.length} image(s), but script has ${panels.length} narration block(s). Use exactly one non-empty line per panel.`,
      });
    }

    files.forEach((file) => cleanup.push(file.path));
    const jobId = `${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
    const segmentPaths = [];
    const timedPanels = [];

    for (let i = 0; i < panels.length; i++) {
      const rawAudio = path.join(UPLOADS_DIR, `tts-${jobId}-${i}.mp3`);
      const syncedAudio = path.join(UPLOADS_DIR, `sync-${jobId}-${i}.mp3`);
      const segmentPath = path.join(UPLOADS_DIR, `segment-${jobId}-${i}.mp4`);
      cleanup.push(rawAudio, syncedAudio, segmentPath);

      await withRetry(() => synthesizeNarration({
        text: panels[i].text,
        voiceGender,
        language,
        tone,
        outPath: rawAudio,
      }), 3);

      const rawDuration = await getDuration(rawAudio);
      const targetDuration = panels[i].targetDuration || Math.max(1.5, rawDuration);
      const duration = await fitAudioToDuration(rawAudio, syncedAudio, targetDuration);
      await createSegment({ imagePath: files[i].path, audioPath: syncedAudio, duration, outPath: segmentPath });
      segmentPaths.push(segmentPath);
      timedPanels.push({ text: panels[i].text, duration: Number(duration.toFixed(3)) });
    }

    const listPath = path.join(UPLOADS_DIR, `segments-${jobId}.txt`);
    const assPath = path.join(UPLOADS_DIR, `subtitles-${jobId}.ass`);
    const mergedPath = path.join(UPLOADS_DIR, `merged-${jobId}.mp4`);
    const outName = `final-${jobId}.mp4`;
    const outPath = path.join(OUTPUT_DIR, outName);
    cleanup.push(listPath, assPath, mergedPath);

    fs.writeFileSync(listPath, segmentPaths.map(safeConcatLine).join("\n"));
    buildSubtitles(timedPanels, assPath);

    await run(ffmpegPath, [
      "-y",
      "-f", "concat",
      "-safe", "0",
      "-i", listPath,
      "-c", "copy",
      mergedPath,
    ], "segment concat");

    await run(ffmpegPath, [
      "-y",
      "-i", mergedPath,
      "-vf", `subtitles='${escapeSubtitlePath(assPath)}'`,
      "-c:v", "libx264",
      "-preset", "veryfast",
      "-pix_fmt", "yuv420p",
      "-c:a", "copy",
      "-movflags", "+faststart",
      outPath,
    ], "subtitle burn");

    cleanup.forEach((p) => { try { if (fs.existsSync(p)) fs.unlinkSync(p); } catch {} });
    const host = `${req.protocol}://${req.get("host")}`;
    res.json({
      videoUrl: `${host}/output/${outName}`,
      panels: timedPanels,
      language,
      tone,
      voiceGender,
    });
  } catch (err) {
    console.error("generate-video error:", err);
    cleanup.forEach((p) => { try { if (fs.existsSync(p)) fs.unlinkSync(p); } catch {} });
    res.status(500).json({ error: "Video generation failed", detail: String(err.message || err) });
  }
});

app.listen(PORT, () => {
  console.log(`video-server listening on :${PORT}`);
});
