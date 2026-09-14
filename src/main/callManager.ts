/**
 * The central orchestrator — wires the hidden capture window, the overlay
 * HUD, the global hotkey, and the Gemini client together. Analogous to
 * Clicky's CompanionManager, but for a continuously-running background
 * pipeline instead of a discrete push-to-talk turn.
 */

import * as config from "./config";
import { CaptureWindow } from "./captureWindow";
import { requestStreamingSuggestion } from "./geminiClient";
import { GlobalHotkey } from "./globalHotkey";
import { OverlayWindow } from "./overlayWindow";
import { SettingsWindow } from "./settingsWindow";
import { TranscriptStore } from "./transcriptStore";
import type {
  ModelsStatus,
  OverlayState,
  SettingsState,
  SuggestionState,
  TranscriptLine,
} from "../shared/types";

const DISPLAYED_TRANSCRIPT_LINE_COUNT = 12;

export class CallManager {
  private readonly transcriptStore = new TranscriptStore();
  private readonly overlayWindow = new OverlayWindow();
  private readonly captureWindow = new CaptureWindow();
  private readonly settingsWindow = new SettingsWindow();
  private globalHotkey: GlobalHotkey | null = null;

  private modelsStatus: ModelsStatus = { state: "idle", progressPercent: 0 };
  private hasMicrophonePermission = false;
  private lastErrorMessage: string | null = null;

  private suggestionState: SuggestionState = "idle";
  private suggestionText = "";
  private currentSuggestionAbortController: AbortController | null = null;

  start(): void {
    this.overlayWindow.create({
      onRequestState: () => this.currentOverlayState(),
      onSubmitQuestion: (questionText) => this.handleSubmitQuestion(questionText),
      onRequestDismiss: () => this.handleRequestDismiss(),
    });

    this.captureWindow.create({
      onTranscriptSegment: (line) => this.handleTranscriptSegment(line),
      onModelsStatus: (status) => {
        this.modelsStatus = status;
        this.publishOverlayState();
      },
      onMicrophonePermissionResult: (isGranted) => {
        this.hasMicrophonePermission = isGranted;
        this.publishOverlayState();
      },
      onCaptureFailed: (source, errorMessage) => {
        this.reportError(`${source} capture failed: ${errorMessage}`);
      },
    });

    this.armGlobalHotkey();

    this.settingsWindow.create({
      onRequestState: () => config.currentSettingsSnapshot(),
      onSave: (update) => this.handleSettingsSave(update),
    });

    setTimeout(() => {
      this.captureWindow.probeMicrophonePermission();
      this.captureWindow.setListeningEnabled(config.isListeningEnabled());
    }, 1000);
  }

  stop(): void {
    this.globalHotkey?.stop();
    this.captureWindow.destroy();
    this.overlayWindow.destroy();
    this.settingsWindow.destroy();
  }

  isListeningEnabled(): boolean {
    return config.isListeningEnabled();
  }

  setListeningEnabled(isEnabled: boolean): void {
    config.setListeningEnabled(isEnabled);
    this.captureWindow.setListeningEnabled(isEnabled);
    this.publishOverlayState();
  }

  openSettings(): void {
    this.settingsWindow.show();
  }

  // -------------------------------------------------------------- hotkey

  /** (Re)registers the global hotkey from whatever config.suggestionHotkey() says right now. */
  private armGlobalHotkey(): void {
    this.globalHotkey?.stop();
    try {
      const hotkeyString = config.suggestionHotkey();
      this.globalHotkey = new GlobalHotkey(hotkeyString, () => {
        this.overlayWindow.showInput();
      });
      this.globalHotkey.start();
      console.log(`Global hotkey armed: hold ${hotkeyString} for a suggestion`);
    } catch (hotkeyError) {
      console.error("Could not start the global hotkey:", hotkeyError);
    }
  }

  // ------------------------------------------------------------- settings

  /**
   * Validates the hotkey before persisting anything — a bad hotkey string
   * shouldn't silently disarm the whole feature. Returns an error message on
   * failure, or null on success (matching SettingsWindowCallbacks.onSave).
   */
  private handleSettingsSave(update: SettingsState): string | null {
    try {
      // Constructed only to validate — thrown away either way; armGlobalHotkey
      // below builds the real instance once the value is actually persisted.
      new GlobalHotkey(update.hotkey, () => {});
    } catch (hotkeyError) {
      return hotkeyError instanceof Error ? hotkeyError.message : String(hotkeyError);
    }

    config.applySettingsUpdate(update);
    this.armGlobalHotkey();
    this.publishOverlayState();
    return null;
  }

  // ------------------------------------------------------------ transcript

  private handleTranscriptSegment(line: TranscriptLine): void {
    console.log(`[${line.channel}] "${line.text}"`);
    this.transcriptStore.append(line);
    this.publishOverlayState();
  }

  // ------------------------------------------------------------ suggestions

  private handleSubmitQuestion(questionText: string): void {
    if (!config.isGeminiConfigured()) {
      this.overlayWindow.sendSuggestionError(
        "Add GEMINI_API_KEY to your .env before asking for a suggestion."
      );
      return;
    }

    this.currentSuggestionAbortController?.abort();
    const abortController = new AbortController();
    this.currentSuggestionAbortController = abortController;

    this.suggestionState = "streaming";
    this.suggestionText = "";
    this.overlayWindow.sendSuggestionStarted();

    const transcriptLines = this.transcriptStore.linesWithinMinutes(config.contextWindowMinutes());

    void requestStreamingSuggestion({
      transcriptLines,
      typedQuestion: questionText,
      priorExchanges: [],
      abortSignal: abortController.signal,
      onTextChunk: (accumulatedText) => {
        this.suggestionText = accumulatedText;
        this.overlayWindow.sendSuggestionChunk(accumulatedText);
      },
    })
      .then(() => {
        if (abortController.signal.aborted) {
          return;
        }
        this.suggestionState = "idle";
      })
      .catch((suggestionError: unknown) => {
        if (abortController.signal.aborted) {
          return;
        }
        const errorMessage =
          suggestionError instanceof Error ? suggestionError.message : String(suggestionError);
        this.suggestionState = "error";
        this.overlayWindow.sendSuggestionError(errorMessage);
      })
      .finally(() => {
        if (this.currentSuggestionAbortController === abortController) {
          this.currentSuggestionAbortController = null;
        }
      });
  }

  private handleRequestDismiss(): void {
    this.currentSuggestionAbortController?.abort();
    this.currentSuggestionAbortController = null;
    this.overlayWindow.releaseFocus();
  }

  // --------------------------------------------------------------- state

  private reportError(errorMessage: string): void {
    console.error(errorMessage);
    this.lastErrorMessage = errorMessage;
    this.publishOverlayState();
  }

  private currentOverlayState(): OverlayState {
    return {
      isListeningEnabled: config.isListeningEnabled(),
      isGeminiConfigured: config.isGeminiConfigured(),
      hasMicrophonePermission: this.hasMicrophonePermission,
      modelsStatus: this.modelsStatus,
      recentTranscript: this.transcriptStore.recentLines().slice(-DISPLAYED_TRANSCRIPT_LINE_COUNT),
      suggestionState: this.suggestionState,
      suggestionText: this.suggestionText,
      lastErrorMessage: this.lastErrorMessage,
      hotkeyLabel: config.suggestionHotkey(),
    };
  }

  private publishOverlayState(): void {
    this.overlayWindow.sendState(this.currentOverlayState());
  }
}
