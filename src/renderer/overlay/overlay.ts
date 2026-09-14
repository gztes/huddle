/**
 * The HUD's UI logic. A pure view over the state the main process publishes —
 * it never holds transcript/suggestion state of its own, it just re-renders
 * whenever a new HuddleOverlayState lands. Mirrors Clicky's panel.ts.
 */

// Wrapped in an IIFE so this file's top-level `const`s get real function
// scope instead of file ("script") scope. tsconfig.renderer.json compiles
// every renderer/*.ts as one non-module project (module: "None"), so two
// classic scripts with same-named top-level consts (this file and
// settings.ts) would otherwise collide during type-checking even though
// they're loaded into entirely separate windows at runtime. `export {}`
// looked like the fix but isn't: with module "None", TS still emits a
// CommonJS `exports` reference for a top-level export statement, which then
// throws ReferenceError in a plain <script> tag — there's no `exports`
// global outside Node/CommonJS. An IIFE avoids the whole problem.
(function (): void {
  const hudStatusButtonElement = document.getElementById("hud-status-button") as HTMLButtonElement;
  const hudTimerElement = document.getElementById("hud-timer") as HTMLSpanElement;
  const setupNoticeElement = document.getElementById("setup-notice") as HTMLElement;
  const modelsNoticeElement = document.getElementById("models-notice") as HTMLElement;
  const modelsTitleElement = document.getElementById("models-title") as HTMLParagraphElement;
  const modelsProgressFillElement = document.getElementById(
    "models-progress-fill"
  ) as HTMLDivElement;
  const microphoneNoticeElement = document.getElementById("microphone-notice") as HTMLElement;
  const transcriptLogElement = document.getElementById("transcript-log") as HTMLDivElement;
  const suggestionSectionElement = document.getElementById("suggestion-section") as HTMLElement;
  const suggestionTextElement = document.getElementById("suggestion-text") as HTMLParagraphElement;
  const quickActionsElement = document.getElementById("quick-actions") as HTMLDivElement;
  const errorSectionElement = document.getElementById("error-section") as HTMLElement;
  const errorTextElement = document.getElementById("error-text") as HTMLParagraphElement;
  const questionFormElement = document.getElementById("question-form") as HTMLFormElement;
  const questionInputElement = document.getElementById("question-input") as HTMLInputElement;
  const listeningIndicatorElement = document.getElementById(
    "listening-indicator"
  ) as HTMLSpanElement;
  const hotkeyHintElement = document.getElementById("hud-hotkey-hint") as HTMLSpanElement;

  let lastRenderedHotkeyLabel: string | null = null;

  /** Rebuilds the toolbar's <kbd> pills from "Ctrl+Alt+H" — only when it actually changes. */
  function renderHotkeyHint(hotkeyLabel: string): void {
    if (hotkeyLabel === lastRenderedHotkeyLabel) {
      return;
    }
    lastRenderedHotkeyLabel = hotkeyLabel;

    const keyElements = hotkeyLabel.split("+").map((keyName) => {
      const kbdElement = document.createElement("kbd");
      kbdElement.textContent = keyName;
      return kbdElement;
    });

    const askLabelElement = document.createElement("span");
    askLabelElement.textContent = "Ask";

    hotkeyHintElement.replaceChildren(...keyElements, askLabelElement);
  }

  function renderOverlayState(overlayState: HuddleOverlayState): void {
    hudStatusButtonElement.dataset.listening = String(overlayState.isListeningEnabled);
    hudStatusButtonElement.title = overlayState.isListeningEnabled
      ? "Listening — click to pause"
      : "Paused — click to resume";
    listeningIndicatorElement.textContent = overlayState.isListeningEnabled ? "Listening" : "Paused";

    renderHotkeyHint(overlayState.hotkeyLabel);

    setupNoticeElement.classList.toggle("is-hidden", overlayState.isGeminiConfigured);

    renderModelsStatus(overlayState.modelsStatus);

    // Only nag about the microphone once the API key is in place, so the user
    // isn't shown two blocking notices at once on first launch.
    const shouldShowMicrophoneNotice =
      overlayState.isGeminiConfigured && !overlayState.hasMicrophonePermission;
    microphoneNoticeElement.classList.toggle("is-hidden", !shouldShowMicrophoneNotice);

    renderTranscript(overlayState.recentTranscript);

    const hasError = overlayState.lastErrorMessage !== null;
    errorSectionElement.classList.toggle("is-hidden", !hasError);
    errorTextElement.textContent = overlayState.lastErrorMessage ?? "";

    // Quick Actions only make sense once a suggestion has actually finished —
    // offering "more detail" mid-stream, or on a stale/errored one, is confusing.
    const shouldShowQuickActions =
      overlayState.suggestionState === "idle" && overlayState.suggestionText.length > 0;
    quickActionsElement.classList.toggle("is-hidden", !shouldShowQuickActions);
  }

  function renderModelsStatus(modelsStatus: HuddleModelsStatus): void {
    const shouldShowNotice = modelsStatus.state === "loading" || modelsStatus.state === "failed";
    modelsNoticeElement.classList.toggle("is-hidden", !shouldShowNotice);

    if (modelsStatus.state === "failed") {
      modelsTitleElement.textContent = "Local models failed to download";
      modelsProgressFillElement.style.width = "0%";
      return;
    }

    modelsTitleElement.textContent = "Downloading local models";
    modelsProgressFillElement.style.width = `${modelsStatus.progressPercent}%`;
  }

  function renderTranscript(recentTranscript: HuddleTranscriptLine[]): void {
    if (recentTranscript.length === 0) {
      const emptyStateElement = document.createElement("p");
      emptyStateElement.id = "transcript-empty-state";
      emptyStateElement.textContent = "Listening for the call…";
      transcriptLogElement.replaceChildren(emptyStateElement);
      return;
    }

    transcriptLogElement.replaceChildren(
      ...recentTranscript.map((line) => {
        const lineElement = document.createElement("p");
        lineElement.className = `transcript-line channel-${line.channel}`;

        const speakerSpan = document.createElement("span");
        speakerSpan.className = "speaker";
        speakerSpan.textContent = line.channel === "you" ? "You" : "Them";

        const textSpan = document.createElement("span");
        textSpan.className = "text";
        textSpan.textContent = line.text;

        lineElement.append(speakerSpan, textSpan);
        return lineElement;
      })
    );
    transcriptLogElement.scrollTop = transcriptLogElement.scrollHeight;
  }

  // --------------------------------------------------------------- toolbar

  /** Click toggles listening directly from the HUD — this is the "stop transcript" control. */
  hudStatusButtonElement.addEventListener("click", () => {
    const isCurrentlyListening = hudStatusButtonElement.dataset.listening === "true";
    window.huddleOverlay.setListeningEnabled(!isCurrentlyListening);
  });

  // A simple mm:ss elapsed-time readout since this window loaded, which is
  // effectively "since the session started" under the one-session-per-launch
  // model. Purely decorative, like Cluely's — not tied to audio activity.
  const sessionStartTimeMs = Date.now();
  function updateElapsedTimer(): void {
    const elapsedSeconds = Math.floor((Date.now() - sessionStartTimeMs) / 1000);
    const minutes = Math.floor(elapsedSeconds / 60);
    const seconds = elapsedSeconds % 60;
    hudTimerElement.textContent = `${minutes}:${String(seconds).padStart(2, "0")}`;
  }
  updateElapsedTimer();
  setInterval(updateElapsedTimer, 1000);

  // ------------------------------------------------------------ suggestion

  /** Focuses the always-visible input — called on the global hotkey. */
  function focusQuestionInput(): void {
    questionInputElement.select();
    questionInputElement.focus();
  }

  questionFormElement.addEventListener("submit", (submitEvent) => {
    submitEvent.preventDefault();
    const questionText = questionInputElement.value;
    questionInputElement.value = "";
    questionInputElement.blur();
    window.huddleOverlay.submitQuestion(questionText, false);
  });

  questionInputElement.addEventListener("keydown", (keyboardEvent) => {
    if (keyboardEvent.key === "Escape") {
      questionInputElement.blur();
      window.huddleOverlay.requestDismiss();
    }
  });

  window.huddleOverlay.onShowInput(() => {
    focusQuestionInput();
  });

  // ------------------------------------------------------------- quick actions

  /** Canned prompts + whether Google Search grounding should be on, per action row. */
  const QUICK_ACTION_PROMPTS: Record<string, { prompt: string; enableWebSearch: boolean }> = {
    "follow-up": {
      prompt: "Suggest 2-3 good follow-up questions I could ask them right now, based on the conversation so far.",
      enableWebSearch: false,
    },
    "more-detail": {
      prompt: "Go deeper on your last suggestion — more specific, more actionable detail.",
      enableWebSearch: false,
    },
    "search-web": {
      prompt: "Search the web for anything relevant to what was just discussed and give me the key facts.",
      enableWebSearch: true,
    },
    recap: {
      prompt:
        "Recap the conversation so far: a short summary, then any action items or open questions, as two clearly labeled sections.",
      enableWebSearch: false,
    },
  };

  quickActionsElement.addEventListener("click", (clickEvent) => {
    const clickedRow = (clickEvent.target as HTMLElement).closest<HTMLButtonElement>(
      ".quick-action-row"
    );
    if (clickedRow === null) {
      return;
    }
    const actionConfig = QUICK_ACTION_PROMPTS[clickedRow.dataset.action ?? ""];
    if (actionConfig === undefined) {
      return;
    }
    window.huddleOverlay.submitQuestion(actionConfig.prompt, actionConfig.enableWebSearch);
  });

  window.huddleOverlay.onSuggestionStarted(() => {
    errorSectionElement.classList.add("is-hidden");
    suggestionSectionElement.classList.remove("is-hidden");
    quickActionsElement.classList.add("is-hidden");
    suggestionTextElement.textContent = "…";
  });

  window.huddleOverlay.onSuggestionChunk((accumulatedText) => {
    suggestionSectionElement.classList.remove("is-hidden");
    suggestionTextElement.textContent = accumulatedText;
  });

  window.huddleOverlay.onSuggestionError((errorMessage) => {
    errorSectionElement.classList.remove("is-hidden");
    errorTextElement.textContent = errorMessage;
  });

  // ---------------------------------------------------------------- boot

  window.huddleOverlay.onStateUpdated(renderOverlayState);
  void window.huddleOverlay.requestState().then(renderOverlayState);
})();
