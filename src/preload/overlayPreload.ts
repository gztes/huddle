/**
 * Preload bridge for the HUD overlay window.
 */

import { contextBridge, ipcRenderer } from "electron";
import { IpcChannels } from "../shared/ipcChannels";
import type { OverlayState, QuestionSubmission } from "../shared/types";

contextBridge.exposeInMainWorld("huddleOverlay", {
  // ---- renderer → main ----

  requestState: (): Promise<OverlayState> => ipcRenderer.invoke(IpcChannels.overlayRequestState),

  submitQuestion: (questionText: string, enableWebSearch: boolean): void => {
    const submission: QuestionSubmission = { questionText, enableWebSearch };
    ipcRenderer.send(IpcChannels.overlaySubmitQuestion, submission);
  },

  requestDismiss: (): void => {
    ipcRenderer.send(IpcChannels.overlayRequestDismiss);
  },

  // ---- main → renderer ----

  onStateUpdated: (handleStateUpdate: (overlayState: OverlayState) => void): void => {
    ipcRenderer.on(IpcChannels.overlayStateUpdated, (_event, overlayState: OverlayState) => {
      handleStateUpdate(overlayState);
    });
  },

  onShowInput: (handleShowInput: () => void): void => {
    ipcRenderer.on(IpcChannels.overlayShowInput, () => handleShowInput());
  },

  onSuggestionStarted: (handleSuggestionStarted: () => void): void => {
    ipcRenderer.on(IpcChannels.overlaySuggestionStarted, () => handleSuggestionStarted());
  },

  onSuggestionChunk: (handleSuggestionChunk: (accumulatedText: string) => void): void => {
    ipcRenderer.on(IpcChannels.overlaySuggestionChunk, (_event, accumulatedText: string) => {
      handleSuggestionChunk(accumulatedText);
    });
  },

  onSuggestionError: (handleSuggestionError: (errorMessage: string) => void): void => {
    ipcRenderer.on(IpcChannels.overlaySuggestionError, (_event, errorMessage: string) => {
      handleSuggestionError(errorMessage);
    });
  },
});
