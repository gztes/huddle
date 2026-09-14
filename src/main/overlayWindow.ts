/**
 * The HUD: a small, focusable, content-protected window pinned to the corner
 * of the primary display. Content protection is the same WDA_EXCLUDEFROMCAPTURE
 * trick Clicky uses for its cursor overlay — it keeps this window out of
 * desktopCapturer's output and any screen-share/recording, which is the whole
 * point of Huddle.
 *
 * Unlike Clicky's cursor overlay, this window is small (not full-screen),
 * focusable, and does not ignore mouse events — the user types into it.
 */

import { BrowserWindow, ipcMain, screen } from "electron";
import * as path from "path";
import { IpcChannels } from "../shared/ipcChannels";
import type { OverlayState } from "../shared/types";

const OVERLAY_WIDTH_PIXELS = 440;
const OVERLAY_HEIGHT_PIXELS = 520;
const OVERLAY_MARGIN_PIXELS = 24;

export interface OverlayWindowCallbacks {
  onRequestState: () => OverlayState;
  onSubmitQuestion: (questionText: string) => void;
  onRequestDismiss: () => void;
}

export class OverlayWindow {
  private browserWindow: BrowserWindow | null = null;

  create(callbacks: OverlayWindowCallbacks): void {
    const primaryDisplay = screen.getPrimaryDisplay();

    this.browserWindow = new BrowserWindow({
      x: primaryDisplay.workArea.x + primaryDisplay.workArea.width - OVERLAY_WIDTH_PIXELS - OVERLAY_MARGIN_PIXELS,
      y: primaryDisplay.workArea.y + OVERLAY_MARGIN_PIXELS,
      width: OVERLAY_WIDTH_PIXELS,
      height: OVERLAY_HEIGHT_PIXELS,
      transparent: true,
      frame: false,
      resizable: false,
      movable: true,
      minimizable: false,
      maximizable: false,
      closable: false,
      focusable: true,
      skipTaskbar: true,
      hasShadow: false,
      alwaysOnTop: true,
      show: false,
      webPreferences: {
        preload: path.join(__dirname, "../preload/overlayPreload.js"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
      },
    });

    this.browserWindow.setAlwaysOnTop(true, "screen-saver");
    this.browserWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

    // The one thing this whole app exists to guarantee: never visible in a
    // screen-share or recording, no matter what's on screen.
    this.browserWindow.setContentProtection(true);

    // A silent renderer crash here would be invisible otherwise — content
    // protection already keeps this window out of screenshots, so logs are
    // the only way to see what it's doing.
    this.browserWindow.webContents.on(
      "console-message",
      (_event, _level, message, lineNumber, sourceId) => {
        console.log(`[overlay] ${message} (${sourceId}:${lineNumber})`);
      }
    );
    this.browserWindow.webContents.on("preload-error", (_event, preloadPath, error) => {
      console.error(`[overlay] preload failed at ${preloadPath}:`, error);
    });
    this.browserWindow.webContents.on("did-fail-load", (_event, errorCode, errorDescription) => {
      console.error(`[overlay] window failed to load: ${errorDescription} (${errorCode})`);
    });
    this.browserWindow.webContents.on("render-process-gone", (_event, details) => {
      console.error(`[overlay] renderer process gone:`, details);
    });

    void this.browserWindow.loadFile(path.join(__dirname, "../renderer/overlay/index.html"));

    this.browserWindow.once("ready-to-show", () => {
      console.log("[overlay] ready-to-show — showing HUD");
      this.browserWindow?.showInactive();
    });

    this.registerIpcHandlers(callbacks);
  }

  private registerIpcHandlers(callbacks: OverlayWindowCallbacks): void {
    ipcMain.handle(IpcChannels.overlayRequestState, () => callbacks.onRequestState());

    ipcMain.on(IpcChannels.overlaySubmitQuestion, (_event, questionText: string) => {
      callbacks.onSubmitQuestion(questionText);
    });

    ipcMain.on(IpcChannels.overlayRequestDismiss, () => {
      callbacks.onRequestDismiss();
    });
  }

  sendState(overlayState: OverlayState): void {
    this.browserWindow?.webContents.send(IpcChannels.overlayStateUpdated, overlayState);
  }

  /** Called when the global hotkey fires — brings the input box to front and focuses it. */
  showInput(): void {
    if (this.browserWindow === null || this.browserWindow.isDestroyed()) {
      return;
    }
    this.browserWindow.showInactive();
    this.browserWindow.focus();
    this.browserWindow.webContents.send(IpcChannels.overlayShowInput);
  }

  sendSuggestionStarted(): void {
    this.browserWindow?.webContents.send(IpcChannels.overlaySuggestionStarted);
  }

  sendSuggestionChunk(accumulatedText: string): void {
    this.browserWindow?.webContents.send(IpcChannels.overlaySuggestionChunk, accumulatedText);
  }

  sendSuggestionError(errorMessage: string): void {
    this.browserWindow?.webContents.send(IpcChannels.overlaySuggestionError, errorMessage);
  }

  /** Returns keyboard focus to whatever the user was in before (e.g. the call app). */
  releaseFocus(): void {
    this.browserWindow?.blur();
  }

  destroy(): void {
    if (this.browserWindow !== null && !this.browserWindow.isDestroyed()) {
      this.browserWindow.destroy();
    }
    this.browserWindow = null;
  }
}
