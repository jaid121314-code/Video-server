# 🎬 ScriptReel

Convert images + narration text into an MP4 video using FFmpeg.

---

## 🚀 Deploy to Railway (Step by Step)

### 1. Create GitHub repo

```bash
git init
git add .
git commit -m "first commit"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/scriptreel.git
git push -u origin main
```

### 2. Deploy on Railway

1. Go to https://railway.app → **New Project**
2. Click **"Deploy from GitHub repo"**
3. Select your repo
4. Railway will auto-detect the `Dockerfile` ✅

### 3. Set environment variable

In Railway → your service → **Variables** tab:
```
PORT = 8080
```

### 4. Generate domain

Railway → your service → **Settings** → **Networking** → **Generate Domain**

Your app will be live at:
`https://your-app.up.railway.app`

---

## 🐳 Run Locally with Docker

```bash
docker build -t scriptreel .
docker run -p 3000:3000 scriptreel
# Open http://localhost:3000
```

## 💻 Run Locally without Docker

Requires: Node.js ≥ 18 + FFmpeg installed

```bash
# Install FFmpeg
# macOS:   brew install ffmpeg
# Ubuntu:  sudo apt install ffmpeg

npm install
npm start
# Open http://localhost:3000
```

---

## 📁 File Structure

```
scriptreel/
├── index.js          ← Express server + FFmpeg logic
├── public/
│   └── index.html    ← Frontend UI (served statically)
├── package.json
├── Dockerfile        ← Railway uses this
├── .dockerignore
├── .gitignore
└── README.md
```

---

## ⚙️ How It Works

1. User uploads images + types narration (1 line per image)
2. Server creates one video segment per image with `fluent-ffmpeg`
3. Text overlay rendered using FFmpeg `drawtext` filter
4. All segments concatenated with FFmpeg concat demuxer
5. Final MP4 returned and displayed in browser

**Duration per panel:** `max(3s, min(12s, wordCount ÷ 2.3 + 1))`
**Resolution:** 1280×720, H.264, 25fps

---

## 🔧 Troubleshooting

| Problem | Fix |
|---|---|
| App not starting | Check Railway logs → Deployments → View Logs |
| FFmpeg not found | Dockerfile installs it — make sure Railway uses Dockerfile builder |
| Port not working | Set `PORT=3000` in Railway Variables |
| Text not rendering | Dockerfile installs `fonts-dejavu-core` — required for drawtext |
| Build fails | Check node_modules is in `.gitignore` and not committed |
