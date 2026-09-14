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
}

/** The lightweight row shown in the History window's session list. */
export interface SessionSummary {
  sessionId: string;
  startedAtMs: number;
  updatedAtMs: number;
  lineCount: number;
  /** First transcript line's text, truncated — stands in for a title. */
  previewText: string;
}
