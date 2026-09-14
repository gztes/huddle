/**
 * Persists call transcripts to disk, one JSON file per session, under
 * userData/sessions/. Deliberately separate from TranscriptStore: that one
 * is a rolling window trimmed for live suggestion context, this one is a
 * full, never-trimmed archive of everything a session ever heard.
 *
 * Local-only — nothing here is ever sent anywhere. This is a real change to
 * Huddle's original "nothing survives a restart" privacy stance, made
 * deliberately: history stays on this machine, but does survive a restart
 * now, unlike the rolling in-memory transcript.
 */

import { app } from "electron";
import * as fs from "fs";
import * as path from "path";
import type { SessionSummary, StoredSession, TranscriptLine } from "../shared/types";

/** How much of the first line to keep as the list-view "title" stand-in. */
const PREVIEW_TEXT_MAX_LENGTH = 80;

export class SessionHistory {
  private currentSession: StoredSession | null = null;

  /** Call once per app launch — each run is its own session. */
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

  /**
   * Appends a line to the current session and writes it to disk immediately
   * — not just on quit — so a crash doesn't silently lose the whole session.
   * Segments arrive every few seconds at most, so this write frequency is
   * fine; no need to batch or debounce it.
   */
  appendLine(line: TranscriptLine): void {
    if (this.currentSession === null) {
      return;
    }
    this.currentSession.lines.push(line);
    this.currentSession.updatedAtMs = Date.now();
    this.persistCurrentSession();
  }

  /**
   * Stores the latest auto-refresh result (summary + action items) as this
   * session's "memory" — reuses the suggestion Gemini already generated for
   * the live overlay rather than making a dedicated summarization call.
   */
  updateSummary(summaryText: string): void {
    if (this.currentSession === null) {
      return;
    }
    this.currentSession.summary = summaryText;
    this.persistCurrentSession();
  }

  private persistCurrentSession(): void {
    if (this.currentSession === null || this.currentSession.lines.length === 0) {
      return; // Never write a session that never heard anything.
    }
    try {
      fs.mkdirSync(sessionsDirectory(), { recursive: true });
      fs.writeFileSync(
        sessionFilePath(this.currentSession.sessionId),
        JSON.stringify(this.currentSession, null, 2),
        "utf8"
      );
    } catch (error) {
      console.error("Could not persist session history:", error);
    }
  }

  /** Every stored session, newest first, as lightweight list-view rows. */
  listSessions(): SessionSummary[] {
    let fileNames: string[];
    try {
      fileNames = fs.readdirSync(sessionsDirectory());
    } catch {
      return []; // No sessions directory yet — nothing stored.
    }

    const summaries: SessionSummary[] = [];
    for (const fileName of fileNames) {
      if (!fileName.endsWith(".json")) {
        continue;
      }
      const session = readSessionFile(path.join(sessionsDirectory(), fileName));
      if (session === null) {
        continue;
      }
      summaries.push({
        sessionId: session.sessionId,
        startedAtMs: session.startedAtMs,
        updatedAtMs: session.updatedAtMs,
        lineCount: session.lines.length,
        previewText: buildPreviewText(session),
        hasSummary: session.summary != null,
      });
    }

    return summaries.sort((a, b) => b.startedAtMs - a.startedAtMs);
  }

  loadSession(sessionId: string): StoredSession | null {
    return readSessionFile(sessionFilePath(sessionId));
  }

  deleteSession(sessionId: string): void {
    try {
      fs.unlinkSync(sessionFilePath(sessionId));
    } catch (error) {
      console.error(`Could not delete session ${sessionId}:`, error);
    }
  }

  deleteAllSessions(): void {
    for (const summary of this.listSessions()) {
      this.deleteSession(summary.sessionId);
    }
  }
}

function sessionsDirectory(): string {
  return path.join(app.getPath("userData"), "sessions");
}

/** sessionId is just the launch timestamp, so this doubles as a sort key. */
function sessionFilePath(sessionId: string): string {
  return path.join(sessionsDirectory(), `${sessionId}.json`);
}

function readSessionFile(filePath: string): StoredSession | null {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as StoredSession;
  } catch {
    return null; // Missing or corrupt — treat as absent rather than crashing.
  }
}

/** Prefers the stored summary (reads as a real gist); falls back to the first line. */
function buildPreviewText(session: StoredSession): string {
  const sourceText = session.summary ?? (session.lines.length > 0 ? session.lines[0].text : null);
  if (sourceText === null) {
    return "(empty session)";
  }
  const singleLineText = sourceText.replace(/\s+/g, " ").trim();
  return singleLineText.length > PREVIEW_TEXT_MAX_LENGTH
    ? `${singleLineText.slice(0, PREVIEW_TEXT_MAX_LENGTH)}…`
    : singleLineText;
}
