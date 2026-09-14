# Calendar Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Huddle passive, read-only awareness of the user's Google Calendar — a "what's next" widget in the tray menu, and past History sessions tagged with the calendar event they overlapped.

**Architecture:** A new main-process module (`calendarClient.ts`) polls a private Google Calendar ICS feed URL (no OAuth) on a 10-minute interval and caches parsed events in memory. `CallManager` owns it and exposes a `nextMeetingLabel()` read for the tray, and tags each session's calendar event title once the first refresh resolves. Everything is inert (returns null / no-ops) until the user pastes an ICS URL into Settings.

**Tech Stack:** Electron main process (TypeScript, CommonJS), `node-ical` for ICS parsing (handles recurring-event/RRULE expansion), no new renderer-side libraries.

**Spec:** `docs/superpowers/specs/2026-09-14-calendar-integration-design.md` (commit bb01699) — read both before starting; this plan pins down exact sequencing/signatures the spec left at the architecture level.

## Global Constraints

- No OAuth, no calendar write access, no write-back of any kind — strictly read-only.
- No Outlook support — Google Calendar ICS only.
- No injection of calendar/meeting context into the Gemini suggestion prompt.
- No auto-arming of listening on a meeting start — manual toggle only, unchanged.
- An empty/unset `calendarIcsUrl` setting must make the entire feature a no-op: `CalendarClient` methods return `null`, the tray shows no extra row, `calendarEventTitle` stays `null` on every session. Never throw or log an error for "no URL configured" — that's the default state, not a failure.
- A failed/erroring ICS fetch logs via `console.error` and keeps the last-known-good cached events rather than clearing them.
- This repo has no automated test suite (no Jest/Vitest, no `test` script in `package.json` — confirmed by inspection). Every task's "test cycle" is `npm run typecheck` plus manual verification, matching how the Session History and Settings features already shipped in this repo. Do not add a test framework — out of scope, unrequested infrastructure.
- Deviation from the spec's literal interface, noted here so it isn't mistaken for a mistake: the spec's Architecture section wrote `SessionHistory.startSession(calendarEventTitle: string | null): void`. This plan instead keeps `startSession(): void` unchanged and adds a separate `setCalendarEventTitle(calendarEventTitle: string): void`, called once `CalendarClient.refresh()` resolves. Reason: `startSession()` must stay synchronous and run before `captureWindow.create()` so an early transcript line is never silently dropped (`appendLine()` no-ops while `currentSession === null`); gating it on a network fetch would risk exactly that. This mirrors the existing `updateSummary()` after-the-fact-update pattern already in `sessionHistory.ts`.
- Gap in the spec's "Files touched" list, found during planning: `src/main/index.ts` also needs a one-line change (passing `nextMeetingLabel` into the existing `trayManager.create({...})` call), since `TrayManager` is instantiated in `index.ts`, not owned by `CallManager`. Covered in Task 4.

---

### Task 1: Calendar ICS URL setting (round-trip through Settings)

**Files:**
- Modify: `src/shared/types.ts` — add `calendarIcsUrl` to `SettingsState`
- Modify: `src/main/config.ts` — add `calendarIcsUrlOverride` + `calendarIcsUrl()` getter, wire into snapshot/apply
- Modify: `src/renderer/globals.d.ts` — add `calendarIcsUrl` to `HuddleSettingsState`
- Modify: `src/renderer/settings/index.html` — new field
- Modify: `src/renderer/settings/settings.ts` — wire the new field

**Interfaces:**
- Produces: `config.calendarIcsUrl(): string` — empty string means unconfigured. Consumed by Task 2's `CalendarClient`.
- Produces: `SettingsState.calendarIcsUrl: string` and `HuddleSettingsState.calendarIcsUrl: string` — consumed by nothing else in this plan, but this is the field the user actually sets.

- [ ] **Step 1: Add the field to `SettingsState`**

In `src/shared/types.ts`, find:

```ts
/** The full set of user-configurable values the settings window edits. */
export interface SettingsState {
  geminiApiKey: string;
  hotkey: string;
  modelIdentifier: string;
  contextWindowMinutes: number;
  transcriptRetentionMinutes: number;
}
```

Replace with:

```ts
/** The full set of user-configurable values the settings window edits. */
export interface SettingsState {
  geminiApiKey: string;
  hotkey: string;
  modelIdentifier: string;
  contextWindowMinutes: number;
  transcriptRetentionMinutes: number;
  /**
   * Google Calendar's private "Secret address in iCal format" URL (Calendar
   * settings → your calendar → that label). Empty string means Calendar
   * integration is off — no tray widget, no History tagging.
   */
  calendarIcsUrl: string;
}
```

- [ ] **Step 2: Add the persisted override + getter in `config.ts`**

In `src/main/config.ts`, find the `PersistedSettings` interface:

```ts
interface PersistedSettings {
  isListeningEnabled: boolean;
  /**
   * Overrides below are unset (undefined) until the user saves them from the
   * Settings window. Unset means "fall through to .env, then the default" —
   * see `configuredValue`. Once set here, they win over .env permanently,
   * which is what lets Settings actually change behavior instead of just
   * echoing whatever the .env file already said.
   */
  geminiApiKeyOverride?: string;
  hotkeyOverride?: string;
  modelIdentifierOverride?: string;
  contextWindowMinutesOverride?: number;
  transcriptRetentionMinutesOverride?: number;
}
```

Add `calendarIcsUrlOverride?: string;` as the last field:

```ts
interface PersistedSettings {
  isListeningEnabled: boolean;
  /**
   * Overrides below are unset (undefined) until the user saves them from the
   * Settings window. Unset means "fall through to .env, then the default" —
   * see `configuredValue`. Once set here, they win over .env permanently,
   * which is what lets Settings actually change behavior instead of just
   * echoing whatever the .env file already said.
   */
  geminiApiKeyOverride?: string;
  hotkeyOverride?: string;
  modelIdentifierOverride?: string;
  contextWindowMinutesOverride?: number;
  transcriptRetentionMinutesOverride?: number;
  calendarIcsUrlOverride?: string;
}
```

Then, right after `transcriptRetentionMinutes()` (still in the "hotkey + timing" section), add a new section and getter:

```ts
// ------------------------------------------------------------------ calendar

/**
 * Google Calendar's private "Secret address in iCal format" URL. Empty
 * string means Calendar integration is off — every CalendarClient method
 * becomes a no-op/null when this is empty.
 */
export function calendarIcsUrl(): string {
  return settings().calendarIcsUrlOverride || configuredValue("HUDDLE_CALENDAR_ICS_URL");
}
```

Then update `currentSettingsSnapshot()`:

```ts
export function currentSettingsSnapshot(): SettingsState {
  return {
    geminiApiKey: geminiApiKey(),
    hotkey: suggestionHotkey(),
    modelIdentifier: modelIdentifier(),
    contextWindowMinutes: contextWindowMinutes(),
    transcriptRetentionMinutes: transcriptRetentionMinutes(),
    calendarIcsUrl: calendarIcsUrl(),
  };
}
```

And `applySettingsUpdate()` — add one line before `persistSettingsToDisk();`:

```ts
export function applySettingsUpdate(update: SettingsState): void {
  const current = settings();
  current.geminiApiKeyOverride = update.geminiApiKey.trim();
  current.hotkeyOverride = update.hotkey.trim();
  current.modelIdentifierOverride = update.modelIdentifier.trim();
  current.contextWindowMinutesOverride = Math.max(1, Math.round(update.contextWindowMinutes) || DEFAULT_CONTEXT_WINDOW_MINUTES);
  current.transcriptRetentionMinutesOverride = Math.max(
    current.contextWindowMinutesOverride,
    Math.round(update.transcriptRetentionMinutes) || DEFAULT_TRANSCRIPT_RETENTION_MINUTES
  );
  current.calendarIcsUrlOverride = update.calendarIcsUrl.trim();
  persistSettingsToDisk();
}
```

- [ ] **Step 3: Mirror the field in the renderer's ambient types**

In `src/renderer/globals.d.ts`, find:

```ts
interface HuddleSettingsState {
  geminiApiKey: string;
  hotkey: string;
  modelIdentifier: string;
  contextWindowMinutes: number;
  transcriptRetentionMinutes: number;
}
```

Replace with:

```ts
interface HuddleSettingsState {
  geminiApiKey: string;
  hotkey: string;
  modelIdentifier: string;
  contextWindowMinutes: number;
  transcriptRetentionMinutes: number;
  calendarIcsUrl: string;
}
```

- [ ] **Step 4: Add the field to the Settings window HTML**

In `src/renderer/settings/index.html`, find the retention field's `</section>` and the `<p id="error-text"` line right after it:

```html
        <section class="field">
          <label for="retention-input">Transcript retention (minutes)</label>
          <input id="retention-input" type="number" min="1" max="240" step="1" />
          <p class="field-hint">How long transcript lines stay in memory at all.</p>
        </section>

        <p id="error-text" class="is-hidden"></p>
```

Insert a new field section between them:

```html
        <section class="field">
          <label for="retention-input">Transcript retention (minutes)</label>
          <input id="retention-input" type="number" min="1" max="240" step="1" />
          <p class="field-hint">How long transcript lines stay in memory at all.</p>
        </section>

        <section class="field">
          <label for="calendar-ics-url-input">Calendar ICS URL</label>
          <input
            id="calendar-ics-url-input"
            type="text"
            placeholder="https://calendar.google.com/calendar/ical/…/private-…/basic.ics"
            autocomplete="off"
          />
          <p class="field-hint">
            Optional — shows your next meeting in the tray menu and tags
            History sessions by the event they overlapped. Find this under
            Google Calendar → Settings → [your calendar] → "Secret address
            in iCal format".
          </p>
        </section>

        <p id="error-text" class="is-hidden"></p>
```

- [ ] **Step 5: Wire the field in `settings.ts`**

In `src/renderer/settings/settings.ts`, add a new element lookup right after `retentionInputElement`:

```ts
  const retentionInputElement = document.getElementById("retention-input") as HTMLInputElement;
  const calendarIcsUrlInputElement = document.getElementById(
    "calendar-ics-url-input"
  ) as HTMLInputElement;
```

In `renderSettingsState()`, add one line:

```ts
  function renderSettingsState(settingsState: HuddleSettingsState): void {
    apiKeyInputElement.value = settingsState.geminiApiKey;
    currentHotkey = settingsState.hotkey;
    hotkeyDisplayElement.textContent = currentHotkey;
    selectedModelIdentifier = settingsState.modelIdentifier;
    renderModelSelection();
    contextWindowInputElement.value = String(settingsState.contextWindowMinutes);
    retentionInputElement.value = String(settingsState.transcriptRetentionMinutes);
    calendarIcsUrlInputElement.value = settingsState.calendarIcsUrl;
  }
```

In `handleSave()`, add one field to the `update` object:

```ts
  function handleSave(): void {
    errorTextElement.classList.add("is-hidden");

    const update: HuddleSettingsState = {
      geminiApiKey: apiKeyInputElement.value,
      hotkey: currentHotkey,
      modelIdentifier: selectedModelIdentifier,
      contextWindowMinutes: Number(contextWindowInputElement.value),
      transcriptRetentionMinutes: Number(retentionInputElement.value),
      calendarIcsUrl: calendarIcsUrlInputElement.value,
    };

    window.huddleSettings.save(update);
  }
```

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 7: Manual verify**

Kill any running Huddle, then:

```powershell
try { Get-Process electron -ErrorAction Stop | Stop-Process -Force } catch {}
```

```bash
cd /c/Users/gonza/huddle && npm start
```

Open the tray → Settings, paste any real "Secret address in iCal format" URL (or a dummy `https://example.com/test.ics` if you don't have one handy) into the new "Calendar ICS URL" field, click Save, close, reopen Settings, and confirm the URL is still there. Then check it actually persisted to disk:

```powershell
Get-Content "$env:APPDATA\huddle\huddle-settings.json" -Raw | ConvertFrom-Json | Select-Object calendarIcsUrlOverride
```

Expected: the URL you pasted.

- [ ] **Step 8: Commit**

```bash
cd /c/Users/gonza/huddle
git add src/shared/types.ts src/main/config.ts src/renderer/globals.d.ts src/renderer/settings/index.html src/renderer/settings/settings.ts
git commit -m "feat: Add Calendar ICS URL setting

First piece of Calendar integration (roadmap 4/4, issue #1). Adds the
one setting the rest of the feature depends on — an optional Google
Calendar private ICS feed URL, following the exact override pattern
every other setting already uses. Empty by default, so this alone has
no behavioral effect yet.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01GpsHW8zBgX449wf6RGoMpq"
```

---

### Task 2: `CalendarClient` module

**Files:**
- Modify: `package.json` — add `node-ical` dependency
- Create: `src/main/calendarClient.ts`

**Interfaces:**
- Consumes: `config.calendarIcsUrl(): string` (Task 1).
- Produces: `export interface CalendarEvent { title: string; startMs: number; endMs: number }`, `export class CalendarClient { refresh(): Promise<void>; eventContaining(timestampMs: number): CalendarEvent | null; nextEvent(fromMs: number): CalendarEvent | null; }`. Consumed by Task 4 (`CallManager`).

- [ ] **Step 1: Add the dependency**

Run: `cd /c/Users/gonza/huddle && npm install node-ical`
Expected: `package.json`'s `dependencies` gains a `node-ical` entry; `package-lock.json` updates. Confirm no new vulnerabilities beyond what's already in the repo: `npm audit` — the only high-severity entries should be the pre-existing `electron`, `@huggingface/transformers`, `extract-zip`, `sharp` ones (already present before this change); `node-ical`'s own subtree (`rrule-temporal`, `temporal-polyfill`, `temporal-spec`, `temporal-utils`) should add none.

- [ ] **Step 2: Write `calendarClient.ts`**

Create `src/main/calendarClient.ts`:

```ts
/**
 * Reads the user's Google Calendar via a private ICS feed URL (no OAuth —
 * see the design spec for why: docs/superpowers/specs/2026-09-14-calendar-integration-design.md)
 * and answers two questions: what's happening right now, and what's next.
 * Read-only — nothing here ever writes back to the calendar. Inert (every
 * method returns null, refresh() no-ops) until a URL is configured in
 * Settings.
 */

import ical from "node-ical";
import * as config from "./config";

export interface CalendarEvent {
  title: string;
  startMs: number;
  endMs: number;
}

/** How far back/forward from "now" events are kept in the cache on each refresh. */
const PAST_WINDOW_MS = 24 * 60 * 60 * 1000;
const FUTURE_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;

export class CalendarClient {
  private cachedEvents: CalendarEvent[] = [];

  /**
   * Re-fetches and re-parses the configured ICS feed. No-ops if no URL is
   * configured. On failure, logs and leaves the last-known-good cache in
   * place rather than clearing it — a transient network hiccup shouldn't
   * blank out an already-working widget.
   */
  async refresh(): Promise<void> {
    const icsUrl = config.calendarIcsUrl();
    if (icsUrl.length === 0) {
      return;
    }
    try {
      const parsedCalendar = await ical.async.fromURL(icsUrl);
      this.cachedEvents = extractUpcomingEvents(parsedCalendar);
      console.log(`Calendar refreshed: ${this.cachedEvents.length} event(s) in range.`);
    } catch (error) {
      console.error("Could not refresh the calendar feed:", error);
    }
  }

  /** The event covering this instant, if any. */
  eventContaining(timestampMs: number): CalendarEvent | null {
    return (
      this.cachedEvents.find(
        (event) => event.startMs <= timestampMs && timestampMs <= event.endMs
      ) ?? null
    );
  }

  /** The soonest upcoming event starting after this instant, if any. Cache is kept sorted by startMs. */
  nextEvent(fromMs: number): CalendarEvent | null {
    return this.cachedEvents.find((event) => event.startMs > fromMs) ?? null;
  }
}

/**
 * Flattens a parsed ICS calendar into a flat, sorted list of events within
 * [now - PAST_WINDOW_MS, now + FUTURE_WINDOW_MS] — recurring events (RRULE)
 * are expanded into individual instances within that same window via
 * node-ical's own expandRecurringEvent, cancelled events/instances are
 * dropped, and one-off events outside the window are skipped to keep the
 * cache small.
 */
function extractUpcomingEvents(parsedCalendar: ical.CalendarResponse): CalendarEvent[] {
  const windowStart = new Date(Date.now() - PAST_WINDOW_MS);
  const windowEnd = new Date(Date.now() + FUTURE_WINDOW_MS);
  const events: CalendarEvent[] = [];

  for (const component of Object.values(parsedCalendar)) {
    if (component?.type !== "VEVENT") {
      continue;
    }
    if (component.status === "CANCELLED") {
      continue;
    }

    if (component.rrule) {
      const instances = ical.expandRecurringEvent(component, {
        from: windowStart,
        to: windowEnd,
        expandOngoing: true,
      });
      for (const instance of instances) {
        if (instance.event.status === "CANCELLED") {
          continue;
        }
        events.push({
          title: plainSummaryText(instance.summary),
          startMs: instance.start.getTime(),
          endMs: instance.end.getTime(),
        });
      }
      continue;
    }

    const endDate = component.end ?? component.start;
    if (component.start.getTime() > windowEnd.getTime() || endDate.getTime() < windowStart.getTime()) {
      continue; // Outside the window we care about.
    }
    events.push({
      title: plainSummaryText(component.summary),
      startMs: component.start.getTime(),
      endMs: endDate.getTime(),
    });
  }

  return events.sort((a, b) => a.startMs - b.startMs);
}

/**
 * SUMMARY is a plain string unless the ICS line carried extra parameters
 * (e.g. LANGUAGE), in which case node-ical wraps it as { val, params }.
 */
function plainSummaryText(summaryValue: ical.VEvent["summary"]): string {
  return typeof summaryValue === "string" ? summaryValue : summaryValue.val;
}
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: no errors. (This file isn't imported anywhere yet, so this only checks it compiles standalone.)

- [ ] **Step 4: Commit**

```bash
cd /c/Users/gonza/huddle
git add package.json package-lock.json src/main/calendarClient.ts
git commit -m "feat: Add CalendarClient (ICS feed fetch + parse)

Second piece of Calendar integration (issue #1). A small class that
fetches and parses a Google Calendar ICS feed, expanding recurring
events correctly via node-ical rather than hand-rolling RRULE
expansion. Not wired into the app yet — CallManager will own an
instance of this in a following commit.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01GpsHW8zBgX449wf6RGoMpq"
```

---

### Task 3: History data model — `calendarEventTitle`

**Files:**
- Modify: `src/shared/types.ts` — add `calendarEventTitle` to `StoredSession` and `SessionSummary`
- Modify: `src/main/sessionHistory.ts` — initialize the field, add `setCalendarEventTitle()`, copy it through in `listSessions()`

**Interfaces:**
- Produces: `StoredSession.calendarEventTitle: string | null`, `SessionSummary.calendarEventTitle: string | null`, `SessionHistory.setCalendarEventTitle(calendarEventTitle: string): void`. Consumed by Task 4 (`CallManager`) and Task 5 (History renderer).

- [ ] **Step 1: Add the field to both shared types**

In `src/shared/types.ts`, find `StoredSession`:

```ts
export interface StoredSession {
  sessionId: string;
  startedAtMs: number;
  updatedAtMs: number;
  lines: TranscriptLine[];
  /**
   * The most recent auto-refresh result (summary + action items), persisted
   * as the session's "memory" — not a separate Gemini call. Null until the
   * first auto-refresh happens during the session (e.g. a call shorter than
   * ~35s never gets one).
   */
  summary: string | null;
}
```

Add `calendarEventTitle` as the last field:

```ts
export interface StoredSession {
  sessionId: string;
  startedAtMs: number;
  updatedAtMs: number;
  lines: TranscriptLine[];
  /**
   * The most recent auto-refresh result (summary + action items), persisted
   * as the session's "memory" — not a separate Gemini call. Null until the
   * first auto-refresh happens during the session (e.g. a call shorter than
   * ~35s never gets one).
   */
  summary: string | null;
  /**
   * The title of the calendar event this session overlapped, if Calendar
   * integration is configured and a match was found. Set once, shortly
   * after the session starts (see CallManager.start()) — never null-to-null
   * "unset" again if a later refresh finds no event.
   */
  calendarEventTitle: string | null;
}
```

And `SessionSummary`:

```ts
/** The lightweight row shown in the History window's session list. */
export interface SessionSummary {
  sessionId: string;
  startedAtMs: number;
  updatedAtMs: number;
  lineCount: number;
  /** The stored summary if there is one, else the first transcript line — truncated either way. */
  previewText: string;
  hasSummary: boolean;
}
```

becomes:

```ts
/** The lightweight row shown in the History window's session list. */
export interface SessionSummary {
  sessionId: string;
  startedAtMs: number;
  updatedAtMs: number;
  lineCount: number;
  /** The stored summary if there is one, else the first transcript line — truncated either way. */
  previewText: string;
  hasSummary: boolean;
  calendarEventTitle: string | null;
}
```

- [ ] **Step 2: Initialize the field in `startSession()`**

In `src/main/sessionHistory.ts`, find:

```ts
  startSession(): void {
    const startedAtMs = Date.now();
    this.currentSession = {
      sessionId: String(startedAtMs),
      startedAtMs,
      updatedAtMs: startedAtMs,
      lines: [],
      summary: null,
    };
  }
```

Add `calendarEventTitle: null,`:

```ts
  startSession(): void {
    const startedAtMs = Date.now();
    this.currentSession = {
      sessionId: String(startedAtMs),
      startedAtMs,
      updatedAtMs: startedAtMs,
      lines: [],
      summary: null,
      calendarEventTitle: null,
    };
  }
```

- [ ] **Step 3: Add `setCalendarEventTitle()`**

Right after `updateSummary()`, add a new method:

```ts
  /**
   * Tags the current session with the calendar event it overlapped. Called
   * once, shortly after the session starts, once CalendarClient's async
   * refresh resolves — see CallManager.start() for why this can't happen
   * synchronously inside startSession() itself. Mirrors updateSummary()'s
   * after-the-fact update pattern.
   */
  setCalendarEventTitle(calendarEventTitle: string): void {
    if (this.currentSession === null) {
      return;
    }
    this.currentSession.calendarEventTitle = calendarEventTitle;
    this.persistCurrentSession();
  }
```

- [ ] **Step 4: Copy the field through in `listSessions()`**

Find:

```ts
      summaries.push({
        sessionId: session.sessionId,
        startedAtMs: session.startedAtMs,
        updatedAtMs: session.updatedAtMs,
        lineCount: session.lines.length,
        previewText: buildPreviewText(session),
        hasSummary: session.summary !== null,
      });
```

Replace with:

```ts
      summaries.push({
        sessionId: session.sessionId,
        startedAtMs: session.startedAtMs,
        updatedAtMs: session.updatedAtMs,
        lineCount: session.lines.length,
        previewText: buildPreviewText(session),
        hasSummary: session.summary != null,
        calendarEventTitle: session.calendarEventTitle ?? null,
      });
```

Note the `!=`/`??` (loose) rather than `!==`/strict null checks — `readSessionFile()` does a plain `JSON.parse(...) as StoredSession` with no default-merging, so session files written before this field (or the `summary` field) existed have it as `undefined` at runtime despite the type saying `string | null`. `!= null`/`??` treat `undefined` and `null` the same way; `!== null` would not, and would misreport old sessions. (This also fixes the pre-existing `hasSummary: session.summary !== null` bug tracked in issue #2 — a deliberate, in-scope fix since this line is being touched anyway and the correct pattern is now written right next to the bug.)

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
cd /c/Users/gonza/huddle
git add src/shared/types.ts src/main/sessionHistory.ts
git commit -m "feat: Add calendarEventTitle to the session history data model

Third piece of Calendar integration (issue #1). StoredSession and
SessionSummary both gain calendarEventTitle: string | null, and
SessionHistory gets setCalendarEventTitle() (mirroring the existing
updateSummary() after-the-fact pattern) for CallManager to call once a
calendar refresh resolves. Not wired into CallManager yet.

Also fixes issue #2 in passing: listSessions() now reads session.summary
with a loose (!=) check instead of strict (!==), since old session files
predating that field have it as undefined, not null, at runtime — the
same fix applied to the new calendarEventTitle field to avoid
reintroducing the same bug.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01GpsHW8zBgX449wf6RGoMpq"
```

---

### Task 4: Wire `CalendarClient` into `CallManager`, the tray, and `index.ts`

**Files:**
- Modify: `src/main/callManager.ts` — own a `CalendarClient`, refresh timer, `nextMeetingLabel()`, session tagging
- Modify: `src/main/trayManager.ts` — new `nextMeetingLabel` callback, menu template
- Modify: `src/main/index.ts` — pass the new callback through

**Interfaces:**
- Consumes: `CalendarClient` (Task 2), `SessionHistory.setCalendarEventTitle()` (Task 3).
- Produces: `CallManager.nextMeetingLabel(): string | null` (public). Consumed by `index.ts`'s `trayManager.create()` call.

- [ ] **Step 1: Wire `CalendarClient` into `CallManager`**

In `src/main/callManager.ts`, add the import:

```ts
import * as config from "./config";
import { CalendarClient } from "./calendarClient";
import { CaptureWindow } from "./captureWindow";
```

(Alphabetical among the existing local imports — insert right after the `config` import, before `CaptureWindow`.)

Add a new constant near `AUTO_REFRESH_INTERVAL_MS`:

```ts
/**
 * How often the calendar cache is re-fetched. Meetings don't move that
 * often — nowhere near the 35s cadence auto-refresh suggestions use.
 */
const CALENDAR_REFRESH_INTERVAL_MS = 10 * 60_000;

/** How far ahead an upcoming event still counts as "next" in the tray label. */
const NEXT_MEETING_HORIZON_MS = 24 * 60 * 60 * 1000;
```

Add a new field alongside the other owned components:

```ts
  private readonly transcriptStore = new TranscriptStore();
  private readonly sessionHistory = new SessionHistory();
  private readonly calendarClient = new CalendarClient();
  private readonly overlayWindow = new OverlayWindow();
```

Add a new timer field alongside `autoRefreshTimer`:

```ts
  private autoRefreshTimer: ReturnType<typeof setInterval> | null = null;
  /** Wall-clock watermark — an auto-refresh only fires if a line arrived after this. */
  private lastAutoRefreshAtMs = 0;

  private calendarRefreshTimer: ReturnType<typeof setInterval> | null = null;
```

In `start()`, capture the session's start time right after `startSession()`, and add the calendar refresh + tagging + interval at the end of the method:

```ts
  start(): void {
    this.sessionHistory.startSession();
    const sessionStartedAtMs = Date.now();

    this.overlayWindow.create({
```

(everything from `this.overlayWindow.create(...)` through the existing `this.autoRefreshTimer = setInterval(...)` line stays exactly as-is)

then, as the last lines of `start()`, after the existing `this.autoRefreshTimer = setInterval(() => this.maybeAutoRefreshSuggestion(), AUTO_REFRESH_INTERVAL_MS);`:

```ts
    this.autoRefreshTimer = setInterval(() => this.maybeAutoRefreshSuggestion(), AUTO_REFRESH_INTERVAL_MS);

    // Tags the session once the first calendar refresh resolves — see the
    // Global Constraints note in the implementation plan for why this isn't
    // done synchronously inside startSession() itself.
    void this.calendarClient.refresh().then(() => {
      const matchingEvent = this.calendarClient.eventContaining(sessionStartedAtMs);
      if (matchingEvent !== null) {
        this.sessionHistory.setCalendarEventTitle(matchingEvent.title);
      }
    });
    this.calendarRefreshTimer = setInterval(
      () => void this.calendarClient.refresh(),
      CALENDAR_REFRESH_INTERVAL_MS
    );
  }
```

In `stop()`, clear the new timer alongside the existing one:

```ts
  stop(): void {
    this.globalHotkey?.stop();
    if (this.autoRefreshTimer !== null) {
      clearInterval(this.autoRefreshTimer);
      this.autoRefreshTimer = null;
    }
    if (this.calendarRefreshTimer !== null) {
      clearInterval(this.calendarRefreshTimer);
      this.calendarRefreshTimer = null;
    }
    this.captureWindow.destroy();
    this.overlayWindow.destroy();
    this.settingsWindow.destroy();
    this.historyWindow.destroy();
  }
```

Add a new public method, right after `openHistory()`:

```ts
  openHistory(): void {
    this.historyWindow.show();
  }

  /**
   * "Now: <title>" / "Next: <title> at H:MM" / null. Computed live each
   * time the tray menu opens — same pattern as isListeningEnabled() already
   * being read live rather than cached.
   */
  nextMeetingLabel(): string | null {
    const now = Date.now();
    const currentEvent = this.calendarClient.eventContaining(now);
    if (currentEvent !== null) {
      return `Now: ${currentEvent.title}`;
    }

    const upcomingEvent = this.calendarClient.nextEvent(now);
    if (upcomingEvent !== null && upcomingEvent.startMs - now <= NEXT_MEETING_HORIZON_MS) {
      const timeLabel = new Date(upcomingEvent.startMs).toLocaleTimeString(undefined, {
        hour: "numeric",
        minute: "2-digit",
      });
      return `Next: ${upcomingEvent.title} at ${timeLabel}`;
    }

    return null;
  }
```

- [ ] **Step 2: Add the tray callback and menu row**

In `src/main/trayManager.ts`, update the import to bring in the menu item type:

```ts
import { Menu, MenuItemConstructorOptions, Tray, app, nativeImage } from "electron";
```

Add the new callback to `TrayCallbacks`:

```ts
export interface TrayCallbacks {
  isListeningEnabled: () => boolean;
  onToggleListening: (isEnabled: boolean) => void;
  onOpenSettings: () => void;
  onOpenHistory: () => void;
  /** "Now: X" / "Next: X at H:MM", or null to show no extra row. Read live each time the menu opens. */
  nextMeetingLabel: () => string | null;
}
```

Replace `buildContextMenu()`:

```ts
  private buildContextMenu(callbacks: TrayCallbacks): Menu {
    const isListening = callbacks.isListeningEnabled();
    const meetingLabel = callbacks.nextMeetingLabel();

    const menuTemplate: MenuItemConstructorOptions[] = [];
    if (meetingLabel !== null) {
      menuTemplate.push({ label: meetingLabel, enabled: false }, { type: "separator" });
    }
    menuTemplate.push(
      {
        label: isListening ? "Pause listening" : "Resume listening",
        click: () => callbacks.onToggleListening(!isListening),
      },
      { type: "separator" },
      { label: "History…", click: () => callbacks.onOpenHistory() },
      { label: "Settings…", click: () => callbacks.onOpenSettings() },
      { type: "separator" },
      { label: "Quit Huddle", click: () => app.quit() }
    );

    return Menu.buildFromTemplate(menuTemplate);
  }
```

- [ ] **Step 3: Wire the callback in `index.ts`**

In `src/main/index.ts`, add one line to the existing `trayManager.create({...})` call:

```ts
    trayManager.create({
      isListeningEnabled: () => callManager.isListeningEnabled(),
      onToggleListening: (isEnabled) => callManager.setListeningEnabled(isEnabled),
      onOpenSettings: () => callManager.openSettings(),
      onOpenHistory: () => callManager.openHistory(),
      nextMeetingLabel: () => callManager.nextMeetingLabel(),
    });
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 5: Manual verify**

This step needs a real ICS URL with at least one event happening soon, so it can't be faked with a dummy URL like Task 1's check could. Use your real Google Calendar "Secret address in iCal format" URL (already pasted into Settings in Task 1 if you have one; paste it now if you used a dummy value there).

Kill any running Huddle and restart with logging captured:

```powershell
try { Get-Process electron -ErrorAction Stop | Stop-Process -Force } catch {}
```

```bash
cd /c/Users/gonza/huddle && npm start > /c/Users/gonza/AppData/Local/Temp/huddle_calendar_verify.log 2>&1 &
```

Wait a few seconds, then check the log for the refresh line:

```bash
grep "Calendar refreshed" /c/Users/gonza/AppData/Local/Temp/huddle_calendar_verify.log
```

Expected: a line like `Calendar refreshed: N event(s) in range.` with N ≥ 0 and no `Could not refresh the calendar feed` error line above it.

Right-click the tray icon and visually confirm the menu (I cannot screenshot a native OS tray menu myself — this specific check needs a human glance): if an event is happening now or within the next 24h, a disabled "Now: …" or "Next: … at H:MM" row appears above "Pause listening"; if nothing's on the calendar soon, no extra row appears and the menu looks exactly as it did before this feature.

If a calendar event is happening right now, confirm the session got tagged:

```powershell
$f = Get-ChildItem "$env:APPDATA\huddle\sessions" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
Get-Content $f.FullName -Raw | ConvertFrom-Json | Select-Object calendarEventTitle
```

Expected: the current event's title (not null). If nothing is on the calendar right now, this will correctly be `null` — that's expected, not a failure; re-test around a real meeting if you want to confirm the positive case.

- [ ] **Step 6: Commit**

```bash
cd /c/Users/gonza/huddle
git add src/main/callManager.ts src/main/trayManager.ts src/main/index.ts
git commit -m "feat: Wire CalendarClient into the tray widget and History tagging

Fourth piece of Calendar integration (issue #1). CallManager now owns
a CalendarClient, refreshes it once at startup and every 10 minutes,
exposes nextMeetingLabel() for the tray (\"Now: X\" / \"Next: X at
H:MM\"), and tags each session's calendarEventTitle once the first
refresh resolves. Feature is now functionally complete in the main
process; History's UI doesn't show the tag yet (next commit).

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01GpsHW8zBgX449wf6RGoMpq"
```

---

### Task 5: Show `calendarEventTitle` in the History window

**Files:**
- Modify: `src/renderer/globals.d.ts` — add `calendarEventTitle` to `HuddleStoredSession` and `HuddleSessionSummary`
- Modify: `src/renderer/history/index.html` — new detail-view heading element
- Modify: `src/renderer/history/history.css` — style for that heading
- Modify: `src/renderer/history/history.ts` — list row + detail view logic

**Interfaces:**
- Consumes: `StoredSession.calendarEventTitle` / `SessionSummary.calendarEventTitle` (Task 3), delivered over the existing generic `historyRequestSessions`/`historyRequestSessionDetail` IPC channels (no new channels needed — both already send the whole object).

- [ ] **Step 1: Mirror the field in the renderer's ambient types**

In `src/renderer/globals.d.ts`, find:

```ts
interface HuddleSessionSummary {
  sessionId: string;
  startedAtMs: number;
  updatedAtMs: number;
  lineCount: number;
  previewText: string;
  hasSummary: boolean;
}

interface HuddleStoredSession {
  sessionId: string;
  startedAtMs: number;
  updatedAtMs: number;
  lines: HuddleTranscriptLine[];
  summary: string | null;
}
```

Replace with:

```ts
interface HuddleSessionSummary {
  sessionId: string;
  startedAtMs: number;
  updatedAtMs: number;
  lineCount: number;
  previewText: string;
  hasSummary: boolean;
  calendarEventTitle: string | null;
}

interface HuddleStoredSession {
  sessionId: string;
  startedAtMs: number;
  updatedAtMs: number;
  lines: HuddleTranscriptLine[];
  summary: string | null;
  calendarEventTitle: string | null;
}
```

- [ ] **Step 2: Add the detail-view heading element**

In `src/renderer/history/index.html`, find:

```html
        <section id="session-detail-view" class="is-hidden">
          <p id="detail-date"></p>
          <div id="detail-summary-section" class="is-hidden">
```

Replace with:

```html
        <section id="session-detail-view" class="is-hidden">
          <p id="detail-event-title" class="is-hidden"></p>
          <p id="detail-date"></p>
          <div id="detail-summary-section" class="is-hidden">
```

- [ ] **Step 3: Style the new heading**

In `src/renderer/history/history.css`, find:

```css
#detail-date {
  font-size: 12px;
  font-weight: 600;
  color: var(--huddle-text-tertiary);
  margin-bottom: 10px;
}
```

Add a new rule right before it:

```css
#detail-event-title {
  font-size: 14px;
  font-weight: 700;
  color: var(--huddle-text-primary);
  margin-bottom: 4px;
}

#detail-date {
  font-size: 12px;
  font-weight: 600;
  color: var(--huddle-text-tertiary);
  margin-bottom: 10px;
}
```

- [ ] **Step 4: Show it in the list view**

In `src/renderer/history/history.ts`, find the row-building code inside `loadAndRenderSessionList()`:

```ts
        const previewElement = document.createElement("span");
        previewElement.className = "session-preview";
        // A real summary reads as a title; a raw first-transcript-line fallback
        // reads as a quote, so it gets a visual cue to tell them apart.
        previewElement.textContent = session.hasSummary
          ? session.previewText
          : `"${session.previewText}"`;
```

Replace with:

```ts
        const calendarEventTitle = session.calendarEventTitle ?? null;
        const previewElement = document.createElement("span");
        previewElement.className = "session-preview";
        // A calendar event title (when present) takes priority as the
        // readable line. Failing that, a real summary reads as a title, and
        // a raw first-transcript-line fallback reads as a quote — a visual
        // cue to tell the two apart.
        if (calendarEventTitle !== null) {
          previewElement.textContent = calendarEventTitle;
        } else {
          previewElement.textContent = session.hasSummary
            ? session.previewText
            : `"${session.previewText}"`;
        }
```

- [ ] **Step 5: Show it in the detail view**

Add a new element lookup near the top of the file, alongside `detailDateElement`:

```ts
  const detailDateElement = document.getElementById("detail-date") as HTMLParagraphElement;
  const detailEventTitleElement = document.getElementById("detail-event-title") as HTMLParagraphElement;
```

In `showSessionDetail()`, find:

```ts
    currentDetailSessionId = sessionId;
    detailDateElement.textContent = formatSessionDate(session.startedAtMs);
```

Replace with:

```ts
    currentDetailSessionId = sessionId;

    const calendarEventTitle = session.calendarEventTitle ?? null;
    detailEventTitleElement.classList.toggle("is-hidden", calendarEventTitle === null);
    detailEventTitleElement.textContent = calendarEventTitle ?? "";

    detailDateElement.textContent = formatSessionDate(session.startedAtMs);
```

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 7: Visual verify via static preview (content-protection-safe technique)**

History's window is not content-protected, but building + serving the compiled renderer directly is still the fastest way to check the visuals without a real calendar event happening right now.

```bash
cd /c/Users/gonza/huddle && npm run build
cd /c/Users/gonza/huddle/dist/renderer/history && (python -m http.server 8843 > /c/Users/gonza/AppData/Local/Temp/huddle_preview_server.log 2>&1 &)
```

Navigate a browser tab to `http://localhost:8843/index.html`, then inject a mock `window.huddleHistory` with one session that has a non-null `calendarEventTitle` and one that doesn't (before the real `history.js` runs), reload the script, and screenshot both the list and detail views. This is the same technique already used to verify the Summary section — see that verification for the exact injection pattern (`window.huddleHistory = { requestSessions: async () => [...], requestSessionDetail: async (id) => ({...}), ... }`, then remove and re-append the `history.js` `<script>` tag).

Expected:
- List row with `calendarEventTitle` set shows the event title as the primary line (not the summary/quote), date is unchanged as the small label above it.
- List row without it looks exactly as before.
- Detail view with `calendarEventTitle` set shows it as a bold heading above the date.
- Detail view without it shows no heading, unchanged from before.

Clean up afterward: close the tab, kill the Python server (`Get-NetTCPConnection -LocalPort 8843 | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }`).

- [ ] **Step 8: Commit**

```bash
cd /c/Users/gonza/huddle
git add src/renderer/globals.d.ts src/renderer/history/index.html src/renderer/history/history.css src/renderer/history/history.ts
git commit -m "feat: Show calendarEventTitle in the History window

Fifth and final functional piece of Calendar integration (issue #1).
The session list now shows a tagged session's calendar event title as
its primary line (falling back to the existing summary/quote when
there isn't one), and the detail view shows it as a heading above the
date. Verified visually via the static-preview technique and against
the CallManager wiring shipped in the previous commit.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01GpsHW8zBgX449wf6RGoMpq"
```

---

### Task 6: Documentation

**Files:**
- Modify: `README.md`

**Interfaces:**
- None — docs only.

- [ ] **Step 1: Mark the roadmap item done**

Find:

```markdown
4. **Calendar integration** — OAuth against Google Calendar/Outlook to
   pre-load context for upcoming meetings. The biggest, most separate piece;
   built last.
```

Replace with:

```markdown
4. ✅ **Calendar integration** — a private Google Calendar ICS feed URL
   (not OAuth — see the design spec for why: read-only display didn't need
   it) drives a "what's next" widget in the tray menu and tags History
   sessions with the calendar event they overlapped. Recurring events
   (RRULE) are parsed correctly via `node-ical`. Opt-in: leave the ICS URL
   unset in Settings and this has no effect at all.
```

- [ ] **Step 2: Add the env var table row and fix the stale `HUDDLE_MODEL` default**

Find:

```markdown
| Variable | Required? | Effect |
|---|---|---|
| `GEMINI_API_KEY` | **Yes** | The only thing Huddle can't work without |
| `HUDDLE_HOTKEY` | No | The suggestion hotkey (default `Ctrl+Alt+H`) |
| `HUDDLE_MODEL` | No | Gemini model id (default `gemini-2.5-flash`) |
| `HUDDLE_CONTEXT_WINDOW_MINUTES` | No | How much recent transcript is sent per suggestion (default 5) |
| `HUDDLE_TRANSCRIPT_RETENTION_MINUTES` | No | How long transcript lines stay in memory at all (default 30) |
| `HUDDLE_WORKER_URL` | No | Proxy through a Cloudflare Worker instead of calling Gemini directly |
```

Replace with:

```markdown
| Variable | Required? | Effect |
|---|---|---|
| `GEMINI_API_KEY` | **Yes** | The only thing Huddle can't work without |
| `HUDDLE_HOTKEY` | No | The suggestion hotkey (default `Ctrl+Alt+H`) |
| `HUDDLE_MODEL` | No | Gemini model id (default `gemini-3.5-flash-lite`) |
| `HUDDLE_CONTEXT_WINDOW_MINUTES` | No | How much recent transcript is sent per suggestion (default 5) |
| `HUDDLE_TRANSCRIPT_RETENTION_MINUTES` | No | How long transcript lines stay in memory at all (default 30) |
| `HUDDLE_WORKER_URL` | No | Proxy through a Cloudflare Worker instead of calling Gemini directly |
| `HUDDLE_CALENDAR_ICS_URL` | No | Google Calendar's private "Secret address in iCal format" URL — enables the tray "what's next" widget and History event tagging |
```

(The `HUDDLE_MODEL` default fix is incidental — the table had drifted stale after `gemini-2.5-flash`'s free-tier quota issue earlier this session; fixed here since this row is already being touched.)

- [ ] **Step 3: Update the Privacy section**

Find:

```markdown
- The HUD overlay is content-protected (`setContentProtection(true)`, same
  trick as Clicky's cursor) — it's excluded from `desktopCapturer`, so it
  never appears in a screen-share or a recording of the call, on either side.
  The History and Settings windows are **not** content-protected — they're
  config/review screens, not meant to be open during a live call.
- Pause listening any time from the tray icon.
```

Replace with:

```markdown
- The HUD overlay is content-protected (`setContentProtection(true)`, same
  trick as Clicky's cursor) — it's excluded from `desktopCapturer`, so it
  never appears in a screen-share or a recording of the call, on either side.
  The History and Settings windows are **not** content-protected — they're
  config/review screens, not meant to be open during a live call.
- Pause listening any time from the tray icon.
- **Calendar integration is opt-in and read-only.** If you paste an ICS URL
  into Settings, Huddle fetches it directly from your machine straight to
  Google's calendar servers — never through any Huddle-controlled backend —
  and only ever holds the parsed events in memory. The single event title a
  session overlaps is the only calendar data that ever touches disk, landing
  in that session's own already-local history file. Huddle never writes
  anything back to your calendar.
```

- [ ] **Step 4: Commit**

```bash
cd /c/Users/gonza/huddle
git add README.md
git commit -m "docs: Mark Calendar integration done, document HUDDLE_CALENDAR_ICS_URL

Closes out the platform roadmap (issue #1) — Settings UI, Quick
Actions, Session History, and Calendar integration are all shipped.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01GpsHW8zBgX449wf6RGoMpq"
```

- [ ] **Step 5: Push and close the tracking issue**

```bash
cd /c/Users/gonza/huddle
git push origin master
gh issue close 1 --repo gztes/huddle --comment "Shipped: tray widget + History tagging, via a private ICS feed URL (not OAuth — read-only scope didn't need it). See README roadmap and the design spec for details."
```
