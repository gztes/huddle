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
