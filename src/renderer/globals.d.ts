/**
 * Types for the APIs the preload scripts expose on `window`.
 *
 * The overlay renderer is compiled with `"module": "None"` (plain script, no
 * bundler, loaded via a `<script>` tag) — see tsconfig.renderer.json. The
 * capture renderer is bundled with esbuild, but still reads these ambient
 * globals for the parts of its window API surface — see tsconfig.capture.json.
 */

type SpeechChannel = "you" | "them";

interface HuddleTranscriptLine {
  channel: SpeechChannel;
  text: string;
  timestampMs: number;
}

interface HuddleModelsStatus {
  state: "idle" | "loading" | "ready" | "failed";
  progressPercent: number;
}

type HuddleSuggestionState = "idle" | "streaming" | "error";

interface HuddleOverlayState {
  isListeningEnabled: boolean;
  isGeminiConfigured: boolean;
  hasMicrophonePermission: boolean;
  modelsStatus: HuddleModelsStatus;
  recentTranscript: HuddleTranscriptLine[];
  suggestionState: HuddleSuggestionState;
  suggestionText: string;
  lastErrorMessage: string | null;
  hotkeyLabel: string;
}

interface HuddleSettingsState {
  geminiApiKey: string;
  hotkey: string;
  modelIdentifier: string;
  contextWindowMinutes: number;
  transcriptRetentionMinutes: number;
}

interface HuddleSettingsApi {
  requestState(): Promise<HuddleSettingsState>;
  save(update: HuddleSettingsState): void;
  requestClose(): void;
  onSaved(handleSaved: () => void): void;
  onSaveFailed(handleSaveFailed: (errorMessage: string) => void): void;
}

interface HuddleOverlayApi {
  requestState(): Promise<HuddleOverlayState>;
  submitQuestion(questionText: string, enableWebSearch: boolean): void;
  requestDismiss(): void;
  onStateUpdated(handleStateUpdate: (overlayState: HuddleOverlayState) => void): void;
  onShowInput(handleShowInput: () => void): void;
  onSuggestionStarted(handleSuggestionStarted: () => void): void;
  onSuggestionChunk(handleSuggestionChunk: (accumulatedText: string) => void): void;
  onSuggestionError(handleSuggestionError: (errorMessage: string) => void): void;
}

interface HuddleCaptureApi {
  onProbeMicrophonePermission(handleProbe: () => void): void;
  onSetListeningEnabled(handleSetListeningEnabled: (isEnabled: boolean) => void): void;
  reportTranscriptSegment(line: HuddleTranscriptLine): void;
  reportModelsStatus(status: HuddleModelsStatus): void;
  reportMicrophonePermission(isGranted: boolean): void;
  reportCaptureFailed(source: string, errorMessage: string): void;
}

interface Window {
  huddleOverlay: HuddleOverlayApi;
  huddleCapture: HuddleCaptureApi;
  huddleSettings: HuddleSettingsApi;
}
