# AURORA Frontend

This React app is the main operator UI for AURORA. It shows live alerts, map/timeline views, analyst chat, and the new voice workflow.

## What talks to what

- React calls the FastAPI backend through `/api/...`
- FastAPI reads `db/aurora.db`
- OpenRouter handles analyst chat + alert synthesis
- ElevenLabs handles speech-to-text and text-to-speech

## Voice workflow

The analyst chat panel now supports:

- microphone capture in the browser
- backend transcription with ElevenLabs Scribe
- transcript cleanup for AURORA terms like `SCADA`, `ICS`, `OSINT`, `OpenRouter`, and `ElevenLabs`
- playback of analyst replies
- playback of a selected alert brief

## Running locally

From the repo root:

```bash
pip install -r requirements.txt
uvicorn api:app --host 127.0.0.1 --port 8000
```

From `frontend/`:

```bash
npm install
npm run dev
```

Open `http://127.0.0.1:5173`.

## Required env vars

Create repo-root `.env` from `.env.example` and set:

```bash
OPENROUTER_API_KEY=...
ELEVENLABS_API_KEY=...
```

Optional:

```bash
ELEVENLABS_VOICE_ID=JBFqnCBsd6RMkjVDRZzb
ELEVENLABS_TTS_MODEL=eleven_flash_v2_5
ELEVENLABS_STT_MODEL=scribe_v2
```

## Demo checklist

1. Open **Controls** and verify the backend and voice statuses are `READY`.
2. Switch to **Dashboard**.
3. Select an alert.
4. Use `Mic`, ask a question, then stop recording.
5. Check the cleaned transcript and press `Send`.
6. Let `Auto-play replies` read the answer aloud, or press `Brief alert`.
