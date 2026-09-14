/**
 * A single-press system-wide hotkey, e.g. "Ctrl+Alt+Space".
 *
 * Uses uiohook-napi, the same listen-only keyboard hook Clicky uses for
 * push-to-talk — Electron's built-in `globalShortcut` would work here too
 * (this hotkey doesn't need press/release, unlike Clicky's), but uiohook is
 * already a dependency of the plumbing this project borrows, and staying off
 * `globalShortcut` means the hotkey never gets silently unregistered by
 * another app grabbing the same accelerator first.
 */

import { uIOhook, UiohookKey, type UiohookKeyboardEvent } from "uiohook-napi";

/** Lowercased key name → keycode, built once from UiohookKey's own names. */
const KEY_NAME_TO_CODE: ReadonlyMap<string, number> = new Map(
  Object.entries(UiohookKey).map(([name, code]) => [name.toLowerCase(), code])
);

const MODIFIER_ALIASES: ReadonlyMap<string, "ctrl" | "alt" | "shift" | "meta"> = new Map([
  ["ctrl", "ctrl"],
  ["control", "ctrl"],
  ["alt", "alt"],
  ["shift", "shift"],
  ["meta", "meta"],
  ["win", "meta"],
  ["windows", "meta"],
  ["cmd", "meta"],
]);

interface ParsedHotkey {
  requiresCtrl: boolean;
  requiresAlt: boolean;
  requiresShift: boolean;
  requiresMeta: boolean;
  triggerKeyCode: number;
}

/** Parses "Ctrl+Alt+Space" into modifier requirements plus one trigger keycode. */
function parseHotkeyString(hotkeyString: string): ParsedHotkey {
  const tokens = hotkeyString.split("+").map((token) => token.trim().toLowerCase());

  const modifiers = { ctrl: false, alt: false, shift: false, meta: false };
  let triggerKeyCode: number | null = null;

  for (const token of tokens) {
    const modifierName = MODIFIER_ALIASES.get(token);
    if (modifierName !== undefined) {
      modifiers[modifierName] = true;
      continue;
    }

    const keyCode = KEY_NAME_TO_CODE.get(token);
    if (keyCode === undefined) {
      throw new Error(`Unrecognised key "${token}" in hotkey "${hotkeyString}"`);
    }
    triggerKeyCode = keyCode;
  }

  if (triggerKeyCode === null) {
    throw new Error(`Hotkey "${hotkeyString}" has no non-modifier trigger key`);
  }

  return {
    requiresCtrl: modifiers.ctrl,
    requiresAlt: modifiers.alt,
    requiresShift: modifiers.shift,
    requiresMeta: modifiers.meta,
    triggerKeyCode,
  };
}

export class GlobalHotkey {
  private readonly parsedHotkey: ParsedHotkey;
  private readonly onTriggered: () => void;

  /** Guards against Windows' key-repeat events firing this over and over while held. */
  private isTriggerKeyCurrentlyDown = false;

  private isHookRunning = false;

  constructor(hotkeyString: string, onTriggered: () => void) {
    this.parsedHotkey = parseHotkeyString(hotkeyString);
    this.onTriggered = onTriggered;
  }

  start(): void {
    if (this.isHookRunning) {
      return;
    }

    uIOhook.on("keydown", this.handleKeyDown);
    uIOhook.on("keyup", this.handleKeyUp);

    try {
      uIOhook.start();
      this.isHookRunning = true;
    } catch (error) {
      console.error("Global hotkey: could not start the keyboard hook:", error);
    }
  }

  stop(): void {
    if (!this.isHookRunning) {
      return;
    }
    uIOhook.off("keydown", this.handleKeyDown);
    uIOhook.off("keyup", this.handleKeyUp);
    try {
      uIOhook.stop();
    } catch (error) {
      console.error("Global hotkey: could not stop the keyboard hook:", error);
    }
    this.isHookRunning = false;
    this.isTriggerKeyCurrentlyDown = false;
  }

  private handleKeyDown = (keyboardEvent: UiohookKeyboardEvent): void => {
    if (keyboardEvent.keycode !== this.parsedHotkey.triggerKeyCode) {
      return;
    }
    if (this.isTriggerKeyCurrentlyDown) {
      return; // key-repeat while held — ignore
    }
    if (!this.modifiersMatch(keyboardEvent)) {
      return;
    }

    this.isTriggerKeyCurrentlyDown = true;
    this.onTriggered();
  };

  private handleKeyUp = (keyboardEvent: UiohookKeyboardEvent): void => {
    if (keyboardEvent.keycode === this.parsedHotkey.triggerKeyCode) {
      this.isTriggerKeyCurrentlyDown = false;
    }
  };

  private modifiersMatch(keyboardEvent: UiohookKeyboardEvent): boolean {
    return (
      keyboardEvent.ctrlKey === this.parsedHotkey.requiresCtrl &&
      keyboardEvent.altKey === this.parsedHotkey.requiresAlt &&
      keyboardEvent.shiftKey === this.parsedHotkey.requiresShift &&
      keyboardEvent.metaKey === this.parsedHotkey.requiresMeta
    );
  }
}
