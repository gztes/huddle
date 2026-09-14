/**
 * Preload bridge for the hidden capture renderer — mic + system-audio loopback
 * capture, Silero VAD, and local Whisper transcription.
 */

import { contextBridge, ipcRenderer } from "electron";
import { IpcChannels } from "../shared/ipcChannels";
import type { ModelsStatus, TranscriptLine } from "../shared/types";

contextBridge.exposeInMainWorld("huddleCapture", {
  // ---- main → renderer ----

  onProbeMicrophonePermission: (handleProbe: () => void): void => {
    ipcRenderer.on(IpcChannels.captureProbeMicrophonePermission, () => handleProbe());
  },

  onSetListeningEnabled: (handleSetListeningEnabled: (isEnabled: boolean) => void): void => {
    ipcRenderer.on(IpcChannels.captureSetListeningEnabled, (_event, isEnabled: boolean) => {
      handleSetListeningEnabled(isEnabled);
    });
  },

  // ---- renderer → main ----

  reportTranscriptSegment: (line: TranscriptLine): void => {
    ipcRenderer.send(IpcChannels.captureTranscriptSegment, line);
  },

  reportModelsStatus: (status: ModelsStatus): void => {
    ipcRenderer.send(IpcChannels.captureModelsStatus, status);
  },

  reportMicrophonePermission: (isGranted: boolean): void => {
    ipcRenderer.send(IpcChannels.captureMicrophonePermissionResult, isGranted);
  },

  reportCaptureFailed: (source: string, errorMessage: string): void => {
    ipcRenderer.send(IpcChannels.captureCaptureFailed, source, errorMessage);
  },
});
