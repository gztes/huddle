/**
 * The HUD's UI logic. A pure view over the state the main process publishes —
 * it never holds transcript/suggestion state of its own, it just re-renders
 * whenever a new HuddleOverlayState lands. Mirrors Clicky's panel.ts.
 */

const hudStatusDotElement = document.getElementById("hud-status-dot") as HTMLDivElement;
const setupNoticeElement = document.getElementById("setup-notice") as HTMLElement;
const modelsNoticeElement = document.getElementById("models-notice") as HTMLElement;
const modelsTitleElement = document.getElementById("models-title") as HTMLParagraphElement;
const modelsProgressFillElement = document.getElementById("models-progress-fill") as HTMLDivElement;
const microphoneNoticeElement = document.getElementById("microphone-notice") as HTMLElement;
const transcriptLogElement = document.getElementById("transcript-log") as HTMLDivElement;
const suggestionSectionElement = document.getElementById("suggestion-section") as HTMLElement;
const suggestionTextElement = document.getElementById("suggestion-text") as HTMLParagraphElement;
const errorSectionElement = document.getElementById("error-section") as HTMLElement;
const errorTextElement = document.getElementById("error-text") as HTMLParagraphElement;
const questionFormElement = document.getElementById("question-form") as HTMLFormElement;
const questionInputElement = document.getElementById("question-input") as HTMLInputElement;
const listeningIndicatorElement = document.getElementById("listening-indicator") as HTMLSpanElement;

function renderOverlayState(overlayState: HuddleOverlayState): void {
  hudStatusDotElement.dataset.listening = String(overlayState.isListeningEnabled);
  listeningIndicatorElement.textContent = overlayState.isListeningEnabled
    ? "Listening"
    : "Paused — resume from the tray icon";

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

// -------------------------------------------------------------- suggestion

function showQuestionInput(): void {
  questionFormElement.classList.remove("is-hidden");
  questionInputElement.value = "";
  questionInputElement.focus();
}

function hideQuestionInput(): void {
  questionFormElement.classList.add("is-hidden");
  questionInputElement.blur();
}

questionFormElement.addEventListener("submit", (submitEvent) => {
  submitEvent.preventDefault();
  const questionText = questionInputElement.value;
  hideQuestionInput();
  window.huddleOverlay.submitQuestion(questionText);
});

questionInputElement.addEventListener("keydown", (keyboardEvent) => {
  if (keyboardEvent.key === "Escape") {
    hideQuestionInput();
    window.huddleOverlay.requestDismiss();
  }
});

window.huddleOverlay.onShowInput(() => {
  showQuestionInput();
});

window.huddleOverlay.onSuggestionStarted(() => {
  errorSectionElement.classList.add("is-hidden");
  suggestionSectionElement.classList.remove("is-hidden");
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

// -------------------------------------------------------------------- boot

window.huddleOverlay.onStateUpdated(renderOverlayState);
void window.huddleOverlay.requestState().then(renderOverlayState);
