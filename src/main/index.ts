/**
 * Application entry point. No main window and no taskbar presence — Huddle
 * lives in the system tray plus the HUD overlay, same posture as Clicky.
 */

import { app, session } from "electron";
import { CallManager } from "./callManager";
import { TrayManager } from "./trayManager";

const callManager = new CallManager();
const trayManager = new TrayManager();

function startHuddle(): void {
  app.whenReady().then(() => {
    // Intercepts every getDisplayMedia() call from the capture renderer and
    // answers it directly with Windows' WASAPI loopback audio device, with no
    // OS "choose what to share" picker and no video track — this is what lets
    // the capture window hear the other side of the call.
    session.defaultSession.setDisplayMediaRequestHandler((_request, callback) => {
      callback({ audio: "loopback" });
    });

    trayManager.create({
      isListeningEnabled: () => callManager.isListeningEnabled(),
      onToggleListening: (isEnabled) => callManager.setListeningEnabled(isEnabled),
    });

    callManager.start();
  });

  // A tray app must stay alive with no windows open. Electron only auto-quits
  // on this event when nothing is listening for it, so registering a handler
  // that deliberately does nothing is what keeps Huddle running in the tray.
  app.on("window-all-closed", () => {
    // Intentionally empty — see above.
  });

  app.on("before-quit", () => {
    callManager.stop();
    trayManager.destroy();
  });
}

// Only one Huddle may run at a time — a second launch would install a second
// keyboard hook and fight over the same userData directory.
const didAcquireSingleInstanceLock = app.requestSingleInstanceLock();

if (!didAcquireSingleInstanceLock) {
  app.quit();
} else {
  startHuddle();
}
