/**
 * The Settings window's UI logic. Loads the current values once, lets the
 * user edit them locally, and only writes anything back on Save.
 */

// Wrapped in an IIFE for real scope isolation from overlay.ts — see the
// comment at the top of overlay.ts for why.
(function (): void {
  /** Kept in sync with AVAILABLE_GEMINI_MODELS in src/shared/types.ts. */
  const SELECTABLE_GEMINI_MODELS = [
    { identifier: "gemini-2.5-flash", displayName: "2.5 Flash", description: "faster, cheaper" },
    { identifier: "gemini-2.5-pro", displayName: "2.5 Pro", description: "smarter, slower" },
  ];

  /** DOM KeyboardEvent.key values that are modifiers, not a trigger key. */
  const MODIFIER_KEY_NAMES = new Set(["Control", "Alt", "Shift", "Meta", "OS"]);

  const apiKeyInputElement = document.getElementById("api-key-input") as HTMLInputElement;
  const toggleKeyVisibilityButton = document.getElementById(
    "toggle-key-visibility-button"
  ) as HTMLButtonElement;
  const hotkeyDisplayElement = document.getElementById("hotkey-display") as HTMLDivElement;
  const changeHotkeyButton = document.getElementById("change-hotkey-button") as HTMLButtonElement;
  const modelOptionsElement = document.getElementById("model-options") as HTMLDivElement;
  const contextWindowInputElement = document.getElementById(
    "context-window-input"
  ) as HTMLInputElement;
  const retentionInputElement = document.getElementById("retention-input") as HTMLInputElement;
  const errorTextElement = document.getElementById("error-text") as HTMLParagraphElement;
  const closeButton = document.getElementById("close-button") as HTMLButtonElement;
  const cancelButton = document.getElementById("cancel-button") as HTMLButtonElement;
  const saveButton = document.getElementById("save-button") as HTMLButtonElement;

  let selectedModelIdentifier = SELECTABLE_GEMINI_MODELS[0].identifier;
  let currentHotkey = "";
  let isRecordingHotkey = false;

  function buildModelOptions(): void {
    for (const selectableModel of SELECTABLE_GEMINI_MODELS) {
      const modelOptionButton = document.createElement("button");
      modelOptionButton.type = "button";
      modelOptionButton.className = "model-option";
      modelOptionButton.dataset.modelIdentifier = selectableModel.identifier;
      modelOptionButton.innerHTML = `
        <span class="model-name"></span>
        <span class="model-description"></span>
      `;
      (modelOptionButton.querySelector(".model-name") as HTMLElement).textContent =
        selectableModel.displayName;
      (modelOptionButton.querySelector(".model-description") as HTMLElement).textContent =
        selectableModel.description;

      modelOptionButton.addEventListener("click", () => {
        selectedModelIdentifier = selectableModel.identifier;
        renderModelSelection();
      });

      modelOptionsElement.appendChild(modelOptionButton);
    }
  }

  function renderModelSelection(): void {
    for (const modelOptionButton of Array.from(
      modelOptionsElement.querySelectorAll<HTMLButtonElement>(".model-option")
    )) {
      modelOptionButton.classList.toggle(
        "is-selected",
        modelOptionButton.dataset.modelIdentifier === selectedModelIdentifier
      );
    }
  }

  function renderSettingsState(settingsState: HuddleSettingsState): void {
    apiKeyInputElement.value = settingsState.geminiApiKey;
    currentHotkey = settingsState.hotkey;
    hotkeyDisplayElement.textContent = currentHotkey;
    selectedModelIdentifier = settingsState.modelIdentifier;
    renderModelSelection();
    contextWindowInputElement.value = String(settingsState.contextWindowMinutes);
    retentionInputElement.value = String(settingsState.transcriptRetentionMinutes);
  }

  // ------------------------------------------------------------ hotkey capture

  function startRecordingHotkey(): void {
    isRecordingHotkey = true;
    hotkeyDisplayElement.classList.add("is-recording");
    hotkeyDisplayElement.textContent = "Press a key combo…";
    changeHotkeyButton.textContent = "Cancel";
  }

  function stopRecordingHotkey(): void {
    isRecordingHotkey = false;
    hotkeyDisplayElement.classList.remove("is-recording");
    hotkeyDisplayElement.textContent = currentHotkey;
    changeHotkeyButton.textContent = "Change";
  }

  /** Turns a DOM KeyboardEvent's key into the same naming globalHotkey.ts expects. */
  function triggerKeyLabel(domKey: string): string {
    if (domKey === " ") {
      return "Space";
    }
    if (domKey.length === 1) {
      return domKey.toUpperCase();
    }
    return domKey; // "Enter", "Escape", "ArrowLeft", "F5", etc. already match.
  }

  window.addEventListener("keydown", (keyboardEvent) => {
    if (!isRecordingHotkey) {
      return;
    }

    keyboardEvent.preventDefault();

    if (keyboardEvent.key === "Escape") {
      stopRecordingHotkey();
      return;
    }

    if (MODIFIER_KEY_NAMES.has(keyboardEvent.key)) {
      return; // Wait for the actual trigger key.
    }

    const modifierParts = [
      keyboardEvent.ctrlKey ? "Ctrl" : null,
      keyboardEvent.altKey ? "Alt" : null,
      keyboardEvent.shiftKey ? "Shift" : null,
      keyboardEvent.metaKey ? "Meta" : null,
    ].filter((part): part is string => part !== null);

    currentHotkey = [...modifierParts, triggerKeyLabel(keyboardEvent.key)].join("+");
    stopRecordingHotkey();
  });

  changeHotkeyButton.addEventListener("click", () => {
    if (isRecordingHotkey) {
      stopRecordingHotkey();
    } else {
      startRecordingHotkey();
    }
  });

  // ---------------------------------------------------------------- actions

  toggleKeyVisibilityButton.addEventListener("click", () => {
    const isCurrentlyHidden = apiKeyInputElement.type === "password";
    apiKeyInputElement.type = isCurrentlyHidden ? "text" : "password";
    toggleKeyVisibilityButton.textContent = isCurrentlyHidden ? "Hide" : "Show";
  });

  function handleSave(): void {
    errorTextElement.classList.add("is-hidden");

    const update: HuddleSettingsState = {
      geminiApiKey: apiKeyInputElement.value,
      hotkey: currentHotkey,
      modelIdentifier: selectedModelIdentifier,
      contextWindowMinutes: Number(contextWindowInputElement.value),
      transcriptRetentionMinutes: Number(retentionInputElement.value),
    };

    window.huddleSettings.save(update);
  }

  saveButton.addEventListener("click", handleSave);
  closeButton.addEventListener("click", () => window.huddleSettings.requestClose());
  cancelButton.addEventListener("click", () => window.huddleSettings.requestClose());

  window.huddleSettings.onSaved(() => {
    window.huddleSettings.requestClose();
  });

  window.huddleSettings.onSaveFailed((errorMessage) => {
    errorTextElement.textContent = errorMessage;
    errorTextElement.classList.remove("is-hidden");
  });

  // -------------------------------------------------------------------- boot

  buildModelOptions();
  void window.huddleSettings.requestState().then(renderSettingsState);
})();
