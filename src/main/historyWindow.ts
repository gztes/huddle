/**
 * The History window — a normal (not content-protected) utility window for
 * browsing and deleting past sessions. Opened from the tray menu.
 */

import { BrowserWindow, ipcMain, screen } from "electron";
import * as path from "path";
import { IpcChannels } from "../shared/ipcChannels";
import type { SessionSummary, StoredSession } from "../shared/types";

const HISTORY_WIDTH_PIXELS = 420;
const HISTORY_HEIGHT_PIXELS = 600;

export interface HistoryWindowCallbacks {
  onRequestSessions: () => SessionSummary[];
  onRequestSessionDetail: (sessionId: string) => StoredSession | null;
  onDeleteSession: (sessionId: string) => void;
  onDeleteAllSessions: () => void;
}

export class HistoryWindow {
  private browserWindow: BrowserWindow | null = null;

  create(callbacks: HistoryWindowCallbacks): void {
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
      x: Math.round(primaryDisplay.workArea.x + (primaryDisplay.workArea.width - HISTORY_WIDTH_PIXELS) / 2),
      y: Math.round(primaryDisplay.workArea.y + (primaryDisplay.workArea.height - HISTORY_HEIGHT_PIXELS) / 2),
      width: HISTORY_WIDTH_PIXELS,
      height: HISTORY_HEIGHT_PIXELS,
      transparent: true,
      frame: false,
      resizable: true,
      minWidth: 340,
      minHeight: 400,
      minimizable: false,
      maximizable: false,
      skipTaskbar: true,
      hasShadow: true,
      alwaysOnTop: false,
      show: false,
      title: "Huddle History",
      webPreferences: {
        preload: path.join(__dirname, "../preload/historyPreload.js"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
      },
    });

    this.browserWindow.webContents.on(
      "console-message",
      (_event, _level, message, lineNumber, sourceId) => {
        console.log(`[history] ${message} (${sourceId}:${lineNumber})`);
      }
    );

    void this.browserWindow.loadFile(path.join(__dirname, "../renderer/history/index.html"));

    this.browserWindow.once("ready-to-show", () => {
      this.browserWindow?.show();
    });

    this.browserWindow.on("closed", () => {
      this.browserWindow = null;
    });
  }

  private registerIpcHandlers(callbacks: HistoryWindowCallbacks): void {
    ipcMain.handle(IpcChannels.historyRequestSessions, () => callbacks.onRequestSessions());

    ipcMain.handle(
      IpcChannels.historyRequestSessionDetail,
      (_event, sessionId: string) => callbacks.onRequestSessionDetail(sessionId)
    );

    ipcMain.on(IpcChannels.historyDeleteSession, (_event, sessionId: string) => {
      callbacks.onDeleteSession(sessionId);
    });

    ipcMain.on(IpcChannels.historyDeleteAllSessions, () => {
      callbacks.onDeleteAllSessions();
    });

    ipcMain.on(IpcChannels.historyRequestClose, () => {
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
