/**
 * A hidden, never-shown window whose only job is audio: capturing the mic and
 * system-audio loopback streams, running Silero VAD on each, and transcribing
 * finished speech segments with local Whisper. Same rationale as Clicky's
 * audioWindow.ts — getUserMedia, getDisplayMedia, AudioWorklet and WebAssembly
 * are all renderer-only APIs, so a hidden renderer hosts them.
 */

import { BrowserWindow, ipcMain } from "electron";
import * as path from "path";
import { IpcChannels } from "../shared/ipcChannels";
import type { ModelsStatus, TranscriptLine } from "../shared/types";

interface QueuedCaptureMessage {
  channelName: string;
  payload?: unknown;
}

export interface CaptureWindowCallbacks {
  onTranscriptSegment: (line: TranscriptLine) => void;
  onModelsStatus: (status: ModelsStatus) => void;
  onMicrophonePermissionResult: (isGranted: boolean) => void;
  onCaptureFailed: (source: string, errorMessage: string) => void;
}

export class CaptureWindow {
  private captureBrowserWindow: BrowserWindow | null = null;

  /**
   * A hidden window loads lazily — Chromium gives it no rendering priority, so
   * its scripts can take a second or more to start executing. Anything sent
   * before that point is silently dropped, because the renderer hasn't
   * registered its IPC handlers yet. So messages are queued until the page
   * reports that it has finished loading, then replayed in order.
   */
  private hasFinishedLoading = false;
  private queuedMessages: QueuedCaptureMessage[] = [];

  create(callbacks: CaptureWindowCallbacks): void {
    if (this.captureBrowserWindow !== null && !this.captureBrowserWindow.isDestroyed()) {
      return;
    }

    this.hasFinishedLoading = false;
    this.queuedMessages = [];

    const captureBrowserWindow = new BrowserWindow({
      width: 320,
      height: 200,
      show: false,
      skipTaskbar: true,
      webPreferences: {
        preload: path.join(__dirname, "../preload/capturePreload.js"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        // This window has to keep listening and transcribing for the whole
        // call while never shown — background throttling would stall it.
        backgroundThrottling: false,
      },
    });

    this.captureBrowserWindow = captureBrowserWindow;

    // Never visible, so anything it logs or throws would otherwise vanish.
    captureBrowserWindow.webContents.on(
      "console-message",
      (_event, _level, message, lineNumber, sourceId) => {
        console.log(`[capture] ${message} (${sourceId}:${lineNumber})`);
      }
    );

    captureBrowserWindow.webContents.on("preload-error", (_event, preloadPath, error) => {
      console.error(`[capture] preload failed at ${preloadPath}:`, error);
    });

    captureBrowserWindow.webContents.on("did-fail-load", (_event, errorCode, errorDescription) => {
      console.error(`[capture] window failed to load: ${errorDescription} (${errorCode})`);
    });

    captureBrowserWindow.webContents.on("did-finish-load", () => {
      this.hasFinishedLoading = true;
      this.flushQueuedMessages();
    });

    this.registerIpcHandlers(callbacks);

    void captureBrowserWindow.loadFile(path.join(__dirname, "../renderer/capture/index.html"));
  }

  private registerIpcHandlers(callbacks: CaptureWindowCallbacks): void {
    ipcMain.on(IpcChannels.captureTranscriptSegment, (_event, line: TranscriptLine) => {
      callbacks.onTranscriptSegment(line);
    });

    ipcMain.on(IpcChannels.captureModelsStatus, (_event, status: ModelsStatus) => {
      callbacks.onModelsStatus(status);
    });

    ipcMain.on(IpcChannels.captureMicrophonePermissionResult, (_event, isGranted: boolean) => {
      callbacks.onMicrophonePermissionResult(isGranted);
    });

    ipcMain.on(
      IpcChannels.captureCaptureFailed,
      (_event, source: string, errorMessage: string) => {
        callbacks.onCaptureFailed(source, errorMessage);
      }
    );
  }

  private flushQueuedMessages(): void {
    const messagesToSend = this.queuedMessages;
    this.queuedMessages = [];
    for (const queuedMessage of messagesToSend) {
      this.sendToCaptureRenderer(queuedMessage.channelName, queuedMessage.payload);
    }
  }

  private sendToCaptureRenderer(channelName: string, payload?: unknown): void {
    if (this.captureBrowserWindow === null || this.captureBrowserWindow.isDestroyed()) {
      return;
    }
    if (!this.hasFinishedLoading) {
      this.queuedMessages.push({ channelName, payload });
      return;
    }
    this.captureBrowserWindow.webContents.send(channelName, payload);
  }

  probeMicrophonePermission(): void {
    this.sendToCaptureRenderer(IpcChannels.captureProbeMicrophonePermission);
  }

  setListeningEnabled(isEnabled: boolean): void {
    this.sendToCaptureRenderer(IpcChannels.captureSetListeningEnabled, isEnabled);
  }

  destroy(): void {
    if (this.captureBrowserWindow !== null && !this.captureBrowserWindow.isDestroyed()) {
      this.captureBrowserWindow.destroy();
    }
    this.captureBrowserWindow = null;
    this.hasFinishedLoading = false;
    this.queuedMessages = [];
  }
}
