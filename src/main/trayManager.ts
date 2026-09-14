/**
 * The system tray icon. Huddle has no dropdown panel like Clicky — the HUD
 * overlay itself is the UI — so the tray menu is where everything else
 * lives: pause listening (privacy control between calls), History, Settings,
 * and quit.
 */

import { Menu, Tray, app, nativeImage } from "electron";
import type { MenuItemConstructorOptions } from "electron";
import * as path from "path";

export interface TrayCallbacks {
  isListeningEnabled: () => boolean;
  onToggleListening: (isEnabled: boolean) => void;
  onOpenSettings: () => void;
  onOpenHistory: () => void;
  /** "Now: <title>" / "Next: <title> at H:MM" / null when nothing to show. Read live each time the menu opens. */
  nextMeetingLabel: () => string | null;
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
    const nextMeetingLabel = callbacks.nextMeetingLabel();

    const menuItems: MenuItemConstructorOptions[] = [];
    if (nextMeetingLabel !== null) {
      menuItems.push({ label: nextMeetingLabel, enabled: false }, { type: "separator" });
    }
    menuItems.push(
      {
        label: isListening ? "Pause listening" : "Resume listening",
        click: () => callbacks.onToggleListening(!isListening),
      },
      { type: "separator" },
      { label: "History…", click: () => callbacks.onOpenHistory() },
      { label: "Settings…", click: () => callbacks.onOpenSettings() },
      { type: "separator" },
      { label: "Quit Huddle", click: () => app.quit() }
    );

    return Menu.buildFromTemplate(menuItems);
  }

  destroy(): void {
    this.trayIcon?.destroy();
    this.trayIcon = null;
  }
}
