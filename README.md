# Video Server (Node + FFmpeg)

## ⚠️ Fix for "spawn /usr/bin/ffmpeg ENOENT"

If you see this error, FFmpeg isn't installed on your host. This bundle now includes:
1. **`ffmpeg-static`** — bundles a working FFmpeg binary with the npm install (works on any host, including Nixpacks)
2. **`Dockerfile`** + **`railway.json`** — forces Railway to build with Docker (apt-get installs ffmpeg)

Either one alone fixes the error. Both together = bulletproof.

## Deploy to Railway

1. Push this folder to a GitHub repo (or use Railway CLI: `railway up`)
2. Railway auto-detects `railway.json` → uses Docker build
3. Wait for deploy → copy the public URL → paste into the frontend

## Endpoint

`POST /generate-video` — multipart/form-data with `images[]` and `narration` (text).
Returns: `{ "videoUrl": "https://your-host/output/xxx.mp4" }`
