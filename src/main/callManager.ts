/**
 * The central orchestrator — wires the hidden capture window, the overlay
 * HUD, the global hotkey, and the Gemini client together. Analogous to
 * Clicky's CompanionManager, but for a continuously-running background
 * pipeline instead of a discrete push-to-talk turn.
 */

import * as config from "./config";
import { CaptureWindow } from "./captureWindow";
import { requestStreamingSuggestion, type SuggestionExchange } from "./geminiClient";
import { GlobalHotkey } from "./globalHotkey";
import { HistoryWindow } from "./historyWindow";
import { OverlayWindow } from "./overlayWindow";
import { SessionHistory } from "./sessionHistory";
import { SettingsWindow } from "./settingsWindow";
import { TranscriptStore } from "./transcriptStore";
import type {
  ModelsStatus,
  OverlayState,
  QuestionSubmission,
  SettingsState,
  SuggestionState,
  TranscriptLine,
} from "../shared/types";

const DISPLAYED_TRANSCRIPT_LINE_COUNT = 12;

/**
 * How often Huddle auto-refreshes the suggestion card without being asked —
 * a "live insights" mode instead of purely hotkey-triggered. Periodic rather
 * than per-line: per-line would mean a Gemini call for every VAD segment,
 * which on a fast-moving conversation could be many calls a minute. This
 * bounds it to roughly one call per half-minute of active talking, and only
 * that often if there's actually something new to react to.
 */
const AUTO_REFRESH_INTERVAL_MS = 35_000;

const AUTO_REFRESH_PROMPT =
  "Give a brief live update: a 1-2 sentence summary of where things stand, " +
  "then any action items, then a short suggestion for what to say or do next.";

export class CallManager {
  private readonly transcriptStore = new TranscriptStore();
  private readonly sessionHistory = new SessionHistory();
  private readonly overlayWindow = new OverlayWindow();
  private readonly captureWindow = new CaptureWindow();
  private readonly settingsWindow = new SettingsWindow();
  private readonly historyWindow = new HistoryWindow();
  private globalHotkey: GlobalHotkey | null = null;

  private modelsStatus: ModelsStatus = { state: "idle", progressPercent: 0 };
  private hasMicrophonePermission = false;
  private lastErrorMessage: string | null = null;

  private suggestionState: SuggestionState = "idle";
  private suggestionText = "";
  private currentSuggestionAbortController: AbortController | null = null;
  /** The most recently finished exchange, so a Quick Action can build on it. */
  private lastExchange: SuggestionExchange | null = null;

  private autoRefreshTimer: ReturnType<typeof setInterval> | null = null;
  /** Wall-clock watermark — an auto-refresh only fires if a line arrived after this. */
  private lastAutoRefreshAtMs = 0;

  start(): void {
    this.sessionHistory.startSession();

    this.overlayWindow.create({
      onRequestState: () => this.currentOverlayState(),
      onSubmitQuestion: (submission) => this.handleSubmitQuestion(submission),
      onRequestDismiss: () => this.handleRequestDismiss(),
      onSetListeningEnabled: (isEnabled) => this.setListeningEnabled(isEnabled),
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

    this.historyWindow.create({
      onRequestSessions: () => this.sessionHistory.listSessions(),
      onRequestSessionDetail: (sessionId) => this.sessionHistory.loadSession(sessionId),
      onDeleteSession: (sessionId) => this.sessionHistory.deleteSession(sessionId),
      onDeleteAllSessions: () => this.sessionHistory.deleteAllSessions(),
    });

    setTimeout(() => {
      this.captureWindow.probeMicrophonePermission();
      this.captureWindow.setListeningEnabled(config.isListeningEnabled());
    }, 1000);

    this.autoRefreshTimer = setInterval(() => this.maybeAutoRefreshSuggestion(), AUTO_REFRESH_INTERVAL_MS);
  }

  stop(): void {
    this.globalHotkey?.stop();
    if (this.autoRefreshTimer !== null) {
      clearInterval(this.autoRefreshTimer);
      this.autoRefreshTimer = null;
    }
    this.captureWindow.destroy();
    this.overlayWindow.destroy();
    this.settingsWindow.destroy();
    this.historyWindow.destroy();
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

  openHistory(): void {
    this.historyWindow.show();
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
    this.sessionHistory.appendLine(line);
    this.publishOverlayState();
  }

  // ------------------------------------------------------------ suggestions

  private handleSubmitQuestion(submission: QuestionSubmission): void {
    if (!config.isGeminiConfigured()) {
      this.overlayWindow.sendSuggestionError(
        "Add GEMINI_API_KEY to your .env before asking for a suggestion."
      );
      return;
    }
    this.runSuggestionRequest(submission.questionText, submission.enableWebSearch, false);
  }

  /**
   * Checks whether it's worth auto-refreshing the suggestion card without
   * being asked. Skips quietly (no error, no log spam) on any of: no key
   * configured, listening paused, a request already in flight (never steps
   * on a manual ask that's still streaming), or nothing new since the last
   * refresh. Note this will happily overwrite a manual answer that finished
   * a while ago — "live insights" are meant to supersede what came before,
   * same as Cluely's; there's no separate "pin this answer" affordance.
   */
  private maybeAutoRefreshSuggestion(): void {
    if (!config.isGeminiConfigured() || !config.isListeningEnabled()) {
      return;
    }
    if (this.currentSuggestionAbortController !== null) {
      return;
    }
    const hasNewLines = this.transcriptStore
      .recentLines()
      .some((line) => line.timestampMs > this.lastAutoRefreshAtMs);
    if (!hasNewLines) {
      return;
    }

    console.log("Auto-refreshing suggestion (new conversation since last check)");
    this.runSuggestionRequest(AUTO_REFRESH_PROMPT, false, true);
  }

  /** Shared by both a typed/Quick Action question and the periodic auto-refresh. */
  private runSuggestionRequest(
    questionText: string,
    enableWebSearch: boolean,
    isAutoRefresh: boolean
  ): void {
    this.currentSuggestionAbortController?.abort();
    const abortController = new AbortController();
    this.currentSuggestionAbortController = abortController;

    this.suggestionState = "streaming";
    this.suggestionText = "";
    this.overlayWindow.sendSuggestionStarted();

    const transcriptLines = this.transcriptStore.linesWithinMinutes(config.contextWindowMinutes());
    // Quick Actions ("more detail", "follow-up questions") only make sense
    // with the prior round in context; a fresh hotkey press starts clean.
    const priorExchanges = this.lastExchange !== null ? [this.lastExchange] : [];

    void requestStreamingSuggestion({
      transcriptLines,
      typedQuestion: questionText,
      priorExchanges,
      enableWebSearch,
      abortSignal: abortController.signal,
      onTextChunk: (accumulatedText) => {
        this.suggestionText = accumulatedText;
        this.overlayWindow.sendSuggestionChunk(accumulatedText);
      },
    })
      .then((finalSuggestionText) => {
        if (abortController.signal.aborted) {
          return;
        }
        this.suggestionState = "idle";
        this.lastExchange = { userQuestion: questionText, suggestionText: finalSuggestionText };
        this.lastAutoRefreshAtMs = Date.now();
        // Only an auto-refresh result becomes the session's persisted
        // "memory" — a one-off manual answer (e.g. "search the web for X")
        // isn't representative of the session as a whole.
        if (isAutoRefresh) {
          this.sessionHistory.updateSummary(finalSuggestionText);
        }
        // The overlay only knows streaming finished once this lands — it has
        // no other terminal event on success, only started/chunk/error.
        this.publishOverlayState();
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
