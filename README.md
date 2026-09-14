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
small, resizable HUD pins itself to the top-right corner of your primary
display (drag it by the pill toolbar, resize from any edge). Both audio
channels start listening immediately; hold the hotkey (default
**Ctrl+Alt+H**) any time you want a suggestion.

### Settings

Right-click the tray icon → **Settings…** for an in-app screen to set the
Gemini key, rebind the hotkey (click "Change" and press a new combo), pick
the model, and adjust the context-window/retention minutes — no `.env`
editing required. Whatever you save there overrides `.env` from then on.

### What each key does

`.env` is just the bootstrap value for each of these — anything saved from
the Settings window takes over from then on.

| Variable | Required? | Effect |
|---|---|---|
| `GEMINI_API_KEY` | **Yes** | The only thing Huddle can't work without |
| `HUDDLE_HOTKEY` | No | The suggestion hotkey (default `Ctrl+Alt+H`) |
| `HUDDLE_MODEL` | No | Gemini model id (default `gemini-2.5-flash`) |
| `HUDDLE_CONTEXT_WINDOW_MINUTES` | No | How much recent transcript is sent per suggestion (default 5) |
| `HUDDLE_TRANSCRIPT_RETENTION_MINUTES` | No | How long transcript lines stay in memory at all (default 30) |
| `HUDDLE_WORKER_URL` | No | Proxy through a Cloudflare Worker instead of calling Gemini directly |

## Privacy

- Both audio channels are transcribed **locally** — Whisper runs on-device,
  the same as Clicky. No audio ever leaves the machine.
- The **live** transcript (what suggestions are grounded in) lives only in
  memory and is dropped after `HUDDLE_TRANSCRIPT_RETENTION_MINUTES` (default
  30) — that part never touches disk.
- **Session history is different, deliberately**: every session is also
  written to a local JSON file (`userData/sessions/`) so you can browse past
  calls from the tray → History. This survives a restart — a real change
  from the original "nothing survives a restart" stance. It is still
  **local-only**: nothing in history is ever uploaded anywhere, and you can
  delete a single session or all of it from the History window.
- Only the lines you explicitly ask about (via the hotkey) are ever sent to
  Gemini, as plain text — session history itself is never sent anywhere.
- The HUD overlay is content-protected (`setContentProtection(true)`, same
  trick as Clicky's cursor) — it's excluded from `desktopCapturer`, so it
  never appears in a screen-share or a recording of the call, on either side.
  The History and Settings windows are **not** content-protected — they're
  config/review screens, not meant to be open during a live call.
- Pause listening any time from the tray icon.

## v1 scope

Deliberately left out for now — see the design brainstorm this was built
from for the reasoning:

- No screen vision (audio + transcript only)
- No spoken/TTS output — the overlay is silent, text-only
- No per-process audio isolation — system-audio capture is the whole output
  device, not just the call app
- Session boundary is one per app launch — no auto-splitting sessions across
  a long-running process that outlives multiple calls

## Roadmap

Agreed build order for turning this from a single-purpose tool into
something closer to a full app, each as its own scoped piece of work:

1. ✅ **Settings UI** — done, see above.
2. ✅ **Quick Actions on suggestions** — three chips appear under a finished
   suggestion: "Follow-up questions," "More detail," and "Search the web"
   (real live grounding via Gemini's Google Search tool, verified against
   the actual API). Skipped a dedicated "define a term" chip — the existing
   free-text question box already covers it ("define X") without needing
   Gemini to guess which term matters.
3. ✅ **Session history** — every session (one per app launch) is written
   incrementally to a local JSON file as it happens, not just on clean quit,
   so a crash doesn't lose it. Tray → History lists past sessions (date +
   first-line preview, no AI-generated titles for v1 — that'd mean an extra
   Gemini call per session) and lets you open one to read the full
   transcript, or delete a session / all history. Local-only, as agreed.
4. **Calendar integration** — OAuth against Google Calendar/Outlook to
   pre-load context for upcoming meetings. The biggest, most separate piece;
   built last.

## Project structure

```
src/
  main/                       # Electron main process
    index.ts                    # entry point, single-instance guard, loopback audio handler
    callManager.ts               # orchestrator — wires capture, overlay, hotkey, Gemini together
    geminiClient.ts              # Gemini SSE streaming + the suggestion system prompt
    transcriptStore.ts           # rolling in-memory transcript, retention window
    sessionHistory.ts            # full-session archive, one JSON file per app launch
    globalHotkey.ts              # parses "Ctrl+Alt+H" style strings, single-press trigger
    overlayWindow.ts             # the content-protected, resizable HUD window
    settingsWindow.ts            # the Settings window (not content-protected)
    historyWindow.ts             # the History window (not content-protected)
    captureWindow.ts             # hidden window hosting mic/system-audio capture + VAD + Whisper
    trayManager.ts               # system tray icon (pause listening, history, settings, quit)
    config.ts                    # .env loading, endpoints, persisted preferences/overrides
  preload/                    # contextBridge APIs, one per window type
  renderer/
    overlay/                    # the HUD: transcript log, suggestion, question input
    settings/                   # API key, hotkey rebinding, model, timing fields
    history/                    # browse/delete past sessions
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
