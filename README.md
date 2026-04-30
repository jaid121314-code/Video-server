# Video Server with Human Narration Sync

This Railway backend now does the missing work:

- Converts each script line into a separate human-like ElevenLabs narration block
- Matches exactly one narration block to exactly one image panel
- Auto-adjusts each panel duration to the generated voice length
- Supports optional timestamps/durations like `[0-5] Panel text` or `[5s] Panel text`
- Slightly time-stretches/trims narration when a target duration is provided
- Merges panel visuals + narration audio with FFmpeg
- Burns word-synced karaoke-style subtitles into the final MP4
- Retries TTS generation automatically before failing

## Required Railway variable

Add this in **Railway → your service → Variables**:

```txt
ELEVENLABS_API_KEY=your_elevenlabs_api_key
```

Then redeploy. Without this key the server cannot create natural human voice narration.

## Deploy to Railway

1. Replace your old server files with this folder.
2. Commit and push to GitHub, or upload with Railway CLI.
3. Railway will use `railway.json` and `Dockerfile`.
4. Paste your Railway public URL into the frontend.

## Endpoint

`POST /generate-video` as `multipart/form-data`:

- `images` — multiple image files, order matters
- `narration` — one non-empty line per image panel
- `voiceGender` — `male` or `female`
- `language` — `en`, `hi`, `ur`, etc. ElevenLabs multilingual voices handle the spoken language from the text.
- `tone` — `storytelling`, `cinematic`, `energetic`, or `dramatic`

Returns:

```json
{
  "videoUrl": "https://your-domain/output/final.mp4"
}
```

## Important script format

For 3 images, write exactly 3 narration lines:

```txt
Panel 1: The night was silent and cold.
Panel 2: Suddenly, a shadow moved across the street.
Panel 3: He realized this was only the beginning.
```

Optional fixed timing:

```txt
[0-5] The night was silent and cold.
[5-9] Suddenly, a shadow moved across the street.
[9-14] He realized this was only the beginning.
```
