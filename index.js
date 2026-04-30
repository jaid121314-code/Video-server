// Node + Express + FFmpeg video generator
// Deploy on Railway / Render / Fly.io / any Docker host.

const express = require("express");
const multer = require("multer");
const cors = require("cors");
const ffmpeg = require("fluent-ffmpeg");
const ffmpegPath = require("ffmpeg-static");
const ffprobePath = require("ffprobe-static").path;
if (ffmpegPath) ffmpeg.setFfmpegPath(ffmpegPath);
if (ffprobePath) ffmpeg.setFfprobePath(ffprobePath);
console.log("ffmpeg path:", ffmpegPath);
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Ensure folders
const UPLOADS_DIR = path.join(__dirname, "uploads");
const OUTPUT_DIR = path.join(__dirname, "output");
fs.mkdirSync(UPLOADS_DIR, { recursive: true });
fs.mkdirSync(OUTPUT_DIR, { recursive: true });

// Serve generated videos
app.use("/output", express.static(OUTPUT_DIR));

// Multer storage
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
  filename: (_req, file, cb) => {
    const id = crypto.randomBytes(6).toString("hex");
    const ext = path.extname(file.originalname) || ".jpg";
    cb(null, `${Date.now()}-${id}${ext}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024 }, // 25 MB per image
});

// Health check
app.get("/", (_req, res) => {
  res.json({ ok: true, service: "video-server" });
});

// Estimate seconds per narration line (approx reading speed: ~2.5 words/sec).
function durationFromText(line) {
  if (!line || !line.trim()) return 3;
  const words = line.trim().split(/\s+/).length;
  const sec = Math.ceil(words / 2.5);
  return Math.min(8, Math.max(3, sec));
}

app.post("/generate-video", upload.array("images", 50), async (req, res) => {
  const cleanup = [];
  try {
    const files = req.files || [];
    if (files.length === 0) {
      return res.status(400).json({ error: "No images uploaded" });
    }
    files.forEach((f) => cleanup.push(f.path));

    const narration = (req.body.narration || "").toString();
    const lines = narration.split(/\r?\n/);

    // Build a concat list: each image displayed for N seconds.
    const listPath = path.join(UPLOADS_DIR, `list-${Date.now()}.txt`);
    cleanup.push(listPath);
    const lineEntries = [];
    files.forEach((file, i) => {
      const dur = durationFromText(lines[i] ?? "");
      // ffmpeg concat demuxer requires a final entry without duration repeated.
      lineEntries.push(`file '${file.path.replace(/'/g, "'\\''")}'`);
      lineEntries.push(`duration ${dur}`);
    });
    // Repeat last file (concat demuxer quirk) so its duration is honoured.
    lineEntries.push(
      `file '${files[files.length - 1].path.replace(/'/g, "'\\''")}'`
    );
    fs.writeFileSync(listPath, lineEntries.join("\n"));

    const outName = `final-${Date.now()}-${crypto
      .randomBytes(4)
      .toString("hex")}.mp4`;
    const outPath = path.join(OUTPUT_DIR, outName);

    await new Promise((resolve, reject) => {
      ffmpeg()
        .input(listPath)
        .inputOptions(["-f", "concat", "-safe", "0"])
        .videoFilters(
          "scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2:color=black,format=yuv420p,fps=30"
        )
        .outputOptions([
          "-pix_fmt", "yuv420p",
          "-c:v", "libx264",
          "-preset", "veryfast",
          "-movflags", "+faststart",
        ])
        .on("start", (cmd) => console.log("ffmpeg cmd:", cmd))
        .on("end", resolve)
        .on("error", reject)
        .save(outPath);
    });

    // Clean inputs (keep output)
    cleanup.forEach((p) => fs.existsSync(p) && fs.unlinkSync(p));

    const host = `${req.protocol}://${req.get("host")}`;
    res.json({ videoUrl: `${host}/output/${outName}` });
  } catch (err) {
    console.error("generate-video error:", err);
    cleanup.forEach((p) => {
      try {
        fs.existsSync(p) && fs.unlinkSync(p);
      } catch {}
    });
    res
      .status(500)
      .json({ error: "Video generation failed", detail: String(err.message || err) });
  }
});

app.listen(PORT, () => {
  console.log(`video-server listening on :${PORT}`);
});
