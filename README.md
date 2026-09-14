# Huddle

A covert call companion for Windows: transcribes both sides of a meeting or
sales call locally, and on a hotkey, asks Gemini for a suggestion — shown on
a small overlay that stays invisible in screen-shares and recordings.

Built on the same Electron plumbing as [Clicky for Windows](../clicky) —
content-protected overlay windows, a local `.env`-configured Gemini client,
and local Whisper transcription — adapted for a continuously-running,
dual-channel, text-only pipeline instead of push-to-talk.

```
you're on a call
   → your mic + system audio (the other side) are each run through
     Silero VAD, which finds bounded speech segments
   → each segment is transcribed locally by Whisper, into a rolling
     in-memory transcript labeled "You" / "Them"
   → hold a hotkey, optionally type a specific question
   → Gemini streams back a short suggestion onto the overlay
   → the overlay is content-protected: invisible in any screen-share
     or recording, on either side of the call
```

**You need exactly one account: a Gemini API key.** Nothing else leaves your
machine — the transcript is never sent anywhere except the few lines you
explicitly ask Gemini to react to.

## Setup

### Prerequisites

- Windows 10 version 2004+ (needed for WASAPI process/loopback audio capture)
- Node.js 18+
- A **Gemini API key** from [aistudio.google.com](https://aistudio.google.com/apikey) (free tier available)

### Run it

```bash
npm install
npm run generate-icons

cp .env.example .env      # then put your key in it

npm start
```

Huddle appears in the system tray — no window, no taskbar entry — and a
small HUD pins itself to the top-right corner of your primary display. Both
audio channels start listening immediately; hold the hotkey (default
**Ctrl+Alt+Space**) any time you want a suggestion.

### What each key does

| Variable | Required? | Effect |
|---|---|---|
| `GEMINI_API_KEY` | **Yes** | The only thing Huddle can't work without |
| `HUDDLE_HOTKEY` | No | The suggestion hotkey (default `Ctrl+Alt+Space`) |
| `HUDDLE_MODEL` | No | Gemini model id (default `gemini-2.5-flash`) |
| `HUDDLE_CONTEXT_WINDOW_MINUTES` | No | How much recent transcript is sent per suggestion (default 5) |
| `HUDDLE_TRANSCRIPT_RETENTION_MINUTES` | No | How long transcript lines stay in memory at all (default 30) |
| `HUDDLE_WORKER_URL` | No | Proxy through a Cloudflare Worker instead of calling Gemini directly |

## Privacy

- Both audio channels are transcribed **locally** — Whisper runs on-device,
  the same as Clicky. No audio ever leaves the machine.
- The transcript lives only in memory and is dropped after
  `HUDDLE_TRANSCRIPT_RETENTION_MINUTES` (default 30) — nothing is written to
  disk, and nothing survives a restart.
- Only the lines you explicitly ask about (via the hotkey) are ever sent to
  Gemini, as plain text.
- The HUD overlay is content-protected (`setContentProtection(true)`, same
  trick as Clicky's cursor) — it's excluded from `desktopCapturer`, so it
  never appears in a screen-share or a recording of the call, on either side.
- Pause listening any time from the tray icon.

## v1 scope

Deliberately left out for now — see the design brainstorm this was built
from for the reasoning:

- No screen vision (audio + transcript only)
- No spoken/TTS output — the overlay is silent, text-only
- No persistent history across calls (in-memory per session only)
- No per-process audio isolation — system-audio capture is the whole output
  device, not just the call app
- No settings UI — everything is `.env`-configured

## Project structure

```
src/
  main/                       # Electron main process
    index.ts                    # entry point, single-instance guard, loopback audio handler
    callManager.ts               # orchestrator — wires capture, overlay, hotkey, Gemini together
    geminiClient.ts              # Gemini SSE streaming + the suggestion system prompt
    transcriptStore.ts           # rolling in-memory transcript, retention window
    globalHotkey.ts              # parses "Ctrl+Alt+Space" style strings, single-press trigger
    overlayWindow.ts             # the content-protected HUD window
    captureWindow.ts             # hidden window hosting mic/system-audio capture + VAD + Whisper
    trayManager.ts               # system tray icon (pause listening, quit)
    config.ts                    # .env loading, endpoints, persisted preferences
  preload/                    # contextBridge APIs, one per window type
  renderer/
    overlay/                    # the HUD: transcript log, suggestion, question input
    capture/                    # mic + system-audio capture, Silero VAD, local Whisper
  shared/                     # types and IPC channel names
```

## Scripts

| Command | What it does |
|---|---|
| `npm start` | Build and run |
| `npm run build` | Compile TypeScript, bundle the capture renderer, copy static assets |
| `npm run typecheck` | Type-check all three projects without emitting |
| `npm run generate-icons` | Regenerate the tray icon PNG |
| `npm run verify` | Sanity-check `GEMINI_API_KEY` against a fake transcript |

## Licence

MIT.
