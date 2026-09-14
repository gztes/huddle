/**
 * The system tray icon. Huddle has no dropdown panel like Clicky — the HUD
 * overlay itself is the UI — so the tray menu just needs to pause listening
 * (privacy control between calls), open Settings, and quit.
 */

import { Menu, Tray, app, nativeImage } from "electron";
import * as path from "path";

export interface TrayCallbacks {
  isListeningEnabled: () => boolean;
  onToggleListening: (isEnabled: boolean) => void;
  onOpenSettings: () => void;
}

export class TrayManager {
  private trayIcon: Tray | null = null;

  create(callbacks: TrayCallbacks): void {
    const trayIconImage = nativeImage.createFromPath(
      path.join(__dirname, "../../assets/trayIcon.png")
    );

    this.trayIcon = new Tray(trayIconImage);
    this.trayIcon.setToolTip("Huddle");

    this.trayIcon.on("click", () => {
      this.trayIcon?.popUpContextMenu(this.buildContextMenu(callbacks));
    });

    this.trayIcon.on("right-click", () => {
      this.trayIcon?.popUpContextMenu(this.buildContextMenu(callbacks));
    });
  }

  private buildContextMenu(callbacks: TrayCallbacks): Menu {
    const isListening = callbacks.isListeningEnabled();
    return Menu.buildFromTemplate([
      {
        label: isListening ? "Pause listening" : "Resume listening",
        click: () => callbacks.onToggleListening(!isListening),
      },
      { label: "Settings…", click: () => callbacks.onOpenSettings() },
      { type: "separator" },
      { label: "Quit Huddle", click: () => app.quit() },
    ]);
  }

  destroy(): void {
    this.trayIcon?.destroy();
    this.trayIcon = null;
  }
}
