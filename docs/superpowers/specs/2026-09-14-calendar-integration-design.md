# Calendar integration — design

Status: approved, pending implementation plan
Roadmap item: 4/4 ("Calendar integration"), the last piece of the agreed
platform roadmap in README.md (Settings UI → Quick Actions → Session
History → Calendar integration).

## Purpose

Give Huddle passive awareness of the user's calendar:

1. A "what's next" widget in the tray menu (current or next meeting).
2. Past sessions in History tagged with the calendar event they happened
   during, so old sessions are findable by meeting name instead of only by
   timestamp.

Explicitly out of scope for this pass (all confirmed with the user during
brainstorming):

- No write access to the calendar — read-only.
- No injection of meeting context into the Gemini suggestion prompt —
  Calendar is purely informational, not suggestion-aware.
- No auto-arming of listening when a meeting starts — the user still
  starts/stops listening manually, same as today.
- Outlook support — Google Calendar only for v1.
- OAuth — see "Why ICS instead of OAuth" below.

## Why ICS instead of OAuth

The README originally sketched "OAuth against Google Calendar/Outlook."
During brainstorming, the actual approved scope turned out to be strictly
read-only display (tray widget + History tagging) — nothing that needs
write access or a polished sign-in UX. Google Calendar exposes a private
"Secret address in iCal format" per calendar (Calendar settings → your
calendar → "Secret address in iCal format") that serves that calendar's
events as a plain ICS feed, readable with a single HTTP GET and no OAuth
handshake at all.

Given the scope, OAuth (Cloud Console project, consent screen, Desktop
client registration, loopback-redirect flow, refresh-token storage) would
be materially more setup for the user and more code for no visible
behavior difference. The ICS approach was chosen instead: the user pastes
one URL into Settings, done. If write access or multi-provider support is
ever wanted later, that's a distinct, larger piece of work and should be
brainstormed as its own project rather than folded in here.

## Architecture

One new main-process module, `src/main/calendarClient.ts`, following the
same shape as `geminiClient.ts` (a small class wrapping raw `fetch` calls,
no SDK for the HTTP part):

```ts
export interface CalendarEvent {
  title: string;
  startMs: number;
  endMs: number;
}

export class CalendarClient {
  /** Re-fetches and re-parses the configured ICS feed. No-ops if no URL is configured. */
  async refresh(): Promise<void>;

  /** The event covering this instant, if any. */
  eventContaining(timestampMs: number): CalendarEvent | null;

  /** The soonest upcoming event starting after this instant, if any. */
  nextEvent(fromMs: number): CalendarEvent | null;
}
```

Internally it holds the last successfully parsed list of events in memory
(no disk persistence needed — cheap to re-fetch on every refresh). ICS
parsing (including recurring-event/RRULE expansion, timezones, and other
RFC 5545 edge cases) is handled by the `node-ical` package rather than a
hand-rolled parser — unlike `.env` parsing (trivial `KEY=value` lines),
ICS recurrence rules are genuinely easy to get subtly wrong, and a
"Weekly Sync"-style recurring meeting is the primary use case this
feature exists for. This is the first dependency added purely for
Calendar integration, in the same spirit as `@ricky0123/vad-web` and
`@huggingface/transformers` being added for capture/transcription where
hand-rolling would be foolish.

`refresh()` failures (bad URL, network hiccup, a revoked secret link) are
caught, logged via `console.error`, and leave the last-known-good cached
events in place rather than clearing them — matching the existing
fail-quiet posture of `captureFailed`/`reportError` elsewhere in the app.
There is no user-facing error surface for v1.

## Wiring

`CallManager` owns the `CalendarClient` instance, alongside its existing
`SessionHistory`, `OverlayWindow`, etc. On `start()`:

- Calls `calendarClient.refresh()` once, then on a 10-minute
  `setInterval` (calendar data doesn't need the 35s cadence
  auto-refresh suggestions use — meetings don't move that often).
- Looks up `calendarClient.eventContaining(startedAtMs)` and passes the
  resulting title (or `null`) into `sessionHistory.startSession(...)`.

### Tray widget

`TrayCallbacks` (in `trayManager.ts`) gains one new callback:

```ts
nextMeetingLabel: () => string | null;
```

Computed live each time the menu opens — same pattern as
`isListeningEnabled` already being read live rather than cached. Logic:

- If `calendarClient.eventContaining(now)` is non-null: `"Now: <title>"`.
- Else if `calendarClient.nextEvent(now)` is non-null AND starts within
  the next 24h: `"Next: <title> at H:MM"`.
- Else: `null` — the tray menu shows no extra row (no ICS URL configured,
  or nothing on the calendar soon).

The tray menu template adds this as a disabled (non-clickable) label item
near the top when non-null, above the existing "Pause/Resume listening"
row.

### History tagging

Shared types (`src/shared/types.ts`) gain one new field, threaded through
both `StoredSession` and `SessionSummary`:

```ts
calendarEventTitle: string | null;
```

`SessionHistory.startSession()` takes a new parameter:

```ts
startSession(calendarEventTitle: string | null): void
```

storing it directly on `currentSession`; `listSessions()` copies it
through to each `SessionSummary` the same way `hasSummary` already is.

In the History renderer:
- **List view** (`history.ts`/`history.css`): when `calendarEventTitle`
  is present, show it as the row's primary label (in place of the
  summary-or-quoted-line preview it currently shows), with the timestamp
  demoted to the existing secondary line. When absent, today's
  timestamp-first layout is unchanged.
- **Detail view**: shows the event title as a heading above the existing
  date line when present; unchanged when absent.

This only ever *adds* a label — it never removes or reinterprets any
data already being shown. Session files from before this field existed
will simply be missing it (`readSessionFile` does a plain
`JSON.parse(...) as StoredSession` with no default-merging), so any code
reading `calendarEventTitle` must treat it as possibly `undefined` at
runtime despite the `string | null` type — use `??`/loose-equality
checks (as `buildPreviewText` already does for `summary`), not
`!== null`, so old sessions degrade to "no title" instead of behaving
oddly.

## Settings

One new field added to `SettingsState`, `PersistedSettings`, and the
Settings window form, following the exact override pattern every other
setting already uses:

- `src/shared/types.ts`: `SettingsState.calendarIcsUrl: string`
- `src/main/config.ts`: `calendarIcsUrlOverride?: string` on
  `PersistedSettings`, a `calendarIcsUrl(): string` getter (override →
  `.env` `HUDDLE_CALENDAR_ICS_URL` → empty string default), included in
  `currentSettingsSnapshot()` and `applySettingsUpdate()`.
- `src/renderer/settings/{index.html,settings.ts}`: one new labeled text
  input, with a short instructional line: "Find this under Google
  Calendar → Settings → [your calendar] → 'Secret address in iCal
  format'."

An empty/unset URL means the whole feature is inert: `CalendarClient`
methods all return `null`/no-op, the tray shows nothing extra, and
`calendarEventTitle` stays `null` on every session — fully backward
compatible and opt-in.

## Privacy

Stays local-only, consistent with the rest of Huddle's stance
(README's Privacy section): the ICS URL is fetched directly from
Huddle's main process straight to Google's calendar servers. It never
passes through any Huddle-controlled backend, and the fetched events are
only ever held in memory (not written to disk) except for the single
`calendarEventTitle` string that lands in a session's own already-local
JSON file.

## Testing

- `npm run typecheck` after implementation.
- Manual verification using a real personal ICS URL: confirm the tray
  shows a real current/upcoming event, start a session during a known
  calendar event, confirm the resulting session file has the correct
  `calendarEventTitle`, and confirm both History views render it.
- No unit tests for ICS parsing itself — that's `node-ical`'s job, not
  ours to re-test.

## Files touched

- New: `src/main/calendarClient.ts` — also where `CalendarEvent` is
  defined. It stays main-process-only: the tray callback returns an
  already-formatted string, and History only ever needs the plain
  `calendarEventTitle` string on `StoredSession`/`SessionSummary` (both
  already shared types) — nothing on the renderer side needs the
  `{title, startMs, endMs}` shape directly, so it's never added to
  `src/shared/types.ts`.
- `src/shared/types.ts` — `SettingsState`, `StoredSession`,
  `SessionSummary` gain the fields described above
- `src/main/config.ts` — new setting getter/override
- `src/main/sessionHistory.ts` — `startSession()` signature,
  `SessionSummary` construction
- `src/main/trayManager.ts` — new callback, menu template
- `src/main/callManager.ts` — owns `CalendarClient`, wires refresh
  interval, passes calendar title into `startSession()` and tray
  callbacks
- `src/renderer/settings/index.html`, `settings.ts` — new field
- `src/renderer/history/index.html`, `history.css`, `history.ts` — show
  `calendarEventTitle` in list + detail views
- `src/renderer/globals.d.ts` — matching ambient type updates
- `package.json` — add `node-ical` dependency
- `README.md` — mark roadmap item 4 done, update Privacy section
