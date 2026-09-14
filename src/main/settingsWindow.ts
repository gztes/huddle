/**
 * The Settings window — a normal (not content-protected) utility window for
 * editing the Gemini key, hotkey, model, and timing values that used to be
 * .env-only. Opened from the tray menu.
 */

import { BrowserWindow, ipcMain, screen } from "electron";
import * as path from "path";
import { IpcChannels } from "../shared/ipcChannels";
import type { SettingsState } from "../shared/types";

const SETTINGS_WIDTH_PIXELS = 400;
const SETTINGS_HEIGHT_PIXELS = 560;

export interface SettingsWindowCallbacks {
  onRequestState: () => SettingsState;
  /** Returns an error message if the save failed (e.g. an unparsable hotkey), or null on success. */
  onSave: (update: SettingsState) => string | null;
}

export class SettingsWindow {
  private browserWindow: BrowserWindow | null = null;
  private callbacks: SettingsWindowCallbacks | null = null;

  create(callbacks: SettingsWindowCallbacks): void {
    this.callbacks = callbacks;
    this.registerIpcHandlers(callbacks);
  }

  /** Opens the window, creating it on first use and just refocusing it after. */
  show(): void {
    if (this.browserWindow !== null && !this.browserWindow.isDestroyed()) {
      this.browserWindow.show();
      this.browserWindow.focus();
      return;
    }

    const primaryDisplay = screen.getPrimaryDisplay();

    this.browserWindow = new BrowserWindow({
      x: Math.round(primaryDisplay.workArea.x + (primaryDisplay.workArea.width - SETTINGS_WIDTH_PIXELS) / 2),
      y: Math.round(primaryDisplay.workArea.y + (primaryDisplay.workArea.height - SETTINGS_HEIGHT_PIXELS) / 2),
      width: SETTINGS_WIDTH_PIXELS,
      height: SETTINGS_HEIGHT_PIXELS,
      transparent: true,
      frame: false,
      resizable: false,
      minimizable: false,
      maximizable: false,
      skipTaskbar: true,
      hasShadow: true,
      alwaysOnTop: false,
      show: false,
      title: "Huddle Settings",
      webPreferences: {
        preload: path.join(__dirname, "../preload/settingsPreload.js"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
      },
    });

    this.browserWindow.webContents.on(
      "console-message",
      (_event, _level, message, lineNumber, sourceId) => {
        console.log(`[settings] ${message} (${sourceId}:${lineNumber})`);
      }
    );

    void this.browserWindow.loadFile(path.join(__dirname, "../renderer/settings/index.html"));

    this.browserWindow.once("ready-to-show", () => {
      this.browserWindow?.show();
    });

    // closable defaults to true here (unlike the overlay), so this just
    // clears the reference rather than needing an explicit destroy() call.
    this.browserWindow.on("closed", () => {
      this.browserWindow = null;
    });
  }

  private registerIpcHandlers(callbacks: SettingsWindowCallbacks): void {
    ipcMain.handle(IpcChannels.settingsRequestState, () => callbacks.onRequestState());

    ipcMain.on(IpcChannels.settingsSave, (_event, update: SettingsState) => {
      const errorMessage = callbacks.onSave(update);
      if (errorMessage !== null) {
        this.browserWindow?.webContents.send(IpcChannels.settingsSaveFailed, errorMessage);
      } else {
        this.browserWindow?.webContents.send(IpcChannels.settingsSaved);
      }
    });

    ipcMain.on(IpcChannels.settingsRequestClose, () => {
      this.browserWindow?.close();
    });
  }

  destroy(): void {
    if (this.browserWindow !== null && !this.browserWindow.isDestroyed()) {
      this.browserWindow.destroy();
    }
    this.browserWindow = null;
  }
}
