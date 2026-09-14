/**
 * Every IPC channel name in one place, so a typo in a string literal can't
 * silently break a message path between processes.
 */
export const IpcChannels = {
  // ---- Capture renderer → main ----
  /** A VAD-bounded speech segment finished transcribing. */
  captureTranscriptSegment: "capture:transcript-segment",
  /** Whisper + Silero VAD model download/warm-up progress. */
  captureModelsStatus: "capture:models-status",
  captureMicrophonePermissionResult: "capture:microphone-permission-result",
  captureCaptureFailed: "capture:capture-failed",

  // ---- Main → capture renderer ----
  captureProbeMicrophonePermission: "capture:probe-microphone-permission",
  captureSetListeningEnabled: "capture:set-listening-enabled",

  // ---- Overlay renderer → main ----
  overlayRequestState: "overlay:request-state",
  overlaySubmitQuestion: "overlay:submit-question",
  overlayRequestDismiss: "overlay:request-dismiss",

  // ---- Main → overlay renderer ----
  overlayStateUpdated: "overlay:state-updated",
  /** Bring the overlay's input box to front and focus it (hotkey pressed). */
  overlayShowInput: "overlay:show-input",
  overlaySuggestionStarted: "overlay:suggestion-started",
  overlaySuggestionChunk: "overlay:suggestion-chunk",
  overlaySuggestionError: "overlay:suggestion-error",

  // ---- Settings renderer → main ----
  settingsRequestState: "settings:request-state",
  settingsSave: "settings:save",
  settingsRequestClose: "settings:request-close",

  // ---- Main → settings renderer ----
  settingsSaved: "settings:saved",
  settingsSaveFailed: "settings:save-failed",
} as const;
