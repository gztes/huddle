/**
 * Shared types used across the main process, preload scripts, and renderers.
 */

/** Which side of the call a transcribed line came from. */
export type SpeechChannel = "you" | "them";

/** One VAD-bounded, Whisper-transcribed segment of speech. */
export interface TranscriptLine {
  channel: SpeechChannel;
  text: string;
  timestampMs: number;
}

/**
 * Progress of the local Whisper + Silero VAD models. Both are downloaded once
 * on first use and cached afterwards, so the overlay needs to show that it's
 * happening rather than appearing to hang on the first launch.
 */
export interface ModelsStatus {
  state: "idle" | "loading" | "ready" | "failed";
  progressPercent: number;
}

export type SuggestionState = "idle" | "streaming" | "error";

/**
 * A question sent to Gemini — either typed freely, or one of the Quick
 * Action chips shown under a finished suggestion. `enableWebSearch` turns on
 * Gemini's Google Search grounding tool for this one request.
 */
export interface QuestionSubmission {
  questionText: string;
  enableWebSearch: boolean;
}

/** State the overlay renderer needs to draw itself. */
export interface OverlayState {
  isListeningEnabled: boolean;
  isGeminiConfigured: boolean;
  hasMicrophonePermission: boolean;
  modelsStatus: ModelsStatus;
  /** Most recent lines, oldest first, already trimmed to the retention window. */
  recentTranscript: TranscriptLine[];
  suggestionState: SuggestionState;
  suggestionText: string;
  lastErrorMessage: string | null;
  /** e.g. "Ctrl+Alt+H" — drives the toolbar hint, kept in sync with config. */
  hotkeyLabel: string;
}

export const AVAILABLE_GEMINI_MODELS = [
  {
    identifier: "gemini-3.5-flash-lite",
    displayName: "3.5 Flash-Lite",
    description: "cheapest, highest free-tier quota",
  },
  { identifier: "gemini-2.5-flash", displayName: "2.5 Flash", description: "faster, cheaper" },
  { identifier: "gemini-2.5-pro", displayName: "2.5 Pro", description: "smarter, slower" },
] as const;

/** The full set of user-configurable values the settings window edits. */
export interface SettingsState {
  geminiApiKey: string;
  hotkey: string;
  modelIdentifier: string;
  contextWindowMinutes: number;
  transcriptRetentionMinutes: number;
  /** Google Calendar's "Secret address in iCal format" for a calendar. Empty disables Calendar integration entirely. */
  calendarIcsUrl: string;
}

/**
 * A full, never-trimmed call session, persisted to disk — separate from
 * TranscriptStore's rolling in-memory window, which is only for live
 * suggestion context and keeps getting trimmed. One file per session under
 * userData/sessions/, local-only, never uploaded anywhere.
 */
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
  /** The calendar event this session overlapped when it started, if Calendar integration is configured. */
  calendarEventTitle: string | null;
}

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
