/**
 * Runtime configuration, API keys, and lightweight persistence.
 *
 * Huddle runs in "local mode": the main process calls Gemini directly, with
 * the key read from a local `.env` file — same approach as Clicky for
 * Windows, which this app borrows its Electron plumbing from.
 */

import { app } from "electron";
import * as fs from "fs";
import * as path from "path";
import type { SettingsState } from "../shared/types";

const DEFAULT_MODEL_IDENTIFIER = "gemini-2.5-flash";
const DEFAULT_HOTKEY = "Ctrl+Alt+H";
const DEFAULT_CONTEXT_WINDOW_MINUTES = 5;
const DEFAULT_TRANSCRIPT_RETENTION_MINUTES = 30;

interface PersistedSettings {
  isListeningEnabled: boolean;
  /**
   * Overrides below are unset (undefined) until the user saves them from the
   * Settings window. Unset means "fall through to .env, then the default" —
   * see `configuredValue`. Once set here, they win over .env permanently,
   * which is what lets Settings actually change behavior instead of just
   * echoing whatever the .env file already said.
   */
  geminiApiKeyOverride?: string;
  hotkeyOverride?: string;
  modelIdentifierOverride?: string;
  contextWindowMinutesOverride?: number;
  transcriptRetentionMinutesOverride?: number;
}

const defaultSettings: PersistedSettings = {
  isListeningEnabled: true,
};

let cachedSettings: PersistedSettings | null = null;
let cachedEnvironmentFileValues: Record<string, string> | null = null;

// ------------------------------------------------------------- .env loading

/**
 * Parses a `.env` file: `KEY=value` per line, `#` comments, optional quotes.
 *
 * Hand-rolled rather than pulling in `dotenv`, because the format we need is
 * this small and the dependency list is worth keeping short.
 */
function parseEnvironmentFile(fileContents: string): Record<string, string> {
  const parsedValues: Record<string, string> = {};

  for (const rawLine of fileContents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith("#")) {
      continue;
    }

    const separatorIndex = line.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    let value = line.slice(separatorIndex + 1).trim();

    // Strip one matching pair of surrounding quotes, if present.
    const isQuoted =
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")));
    if (isQuoted) {
      value = value.slice(1, -1);
    }

    if (key.length > 0) {
      parsedValues[key] = value;
    }
  }

  return parsedValues;
}

/**
 * Where to look for `.env`, most specific first.
 *
 * In development that's the project root. Once packaged there is no project
 * root, so the userData folder is the place a user can actually edit.
 */
function candidateEnvironmentFilePaths(): string[] {
  return [
    path.join(app.getAppPath(), ".env"),
    path.join(path.dirname(app.getPath("exe")), ".env"),
    path.join(app.getPath("userData"), ".env"),
  ];
}

function environmentFileValues(): Record<string, string> {
  if (cachedEnvironmentFileValues !== null) {
    return cachedEnvironmentFileValues;
  }

  for (const candidatePath of candidateEnvironmentFilePaths()) {
    try {
      const fileContents = fs.readFileSync(candidatePath, "utf8");
      cachedEnvironmentFileValues = parseEnvironmentFile(fileContents);
      console.log(`Loaded configuration from ${candidatePath}`);
      return cachedEnvironmentFileValues;
    } catch {
      // Not at this path — try the next one.
    }
  }

  cachedEnvironmentFileValues = {};
  return cachedEnvironmentFileValues;
}

/** A real process environment variable wins over anything in the .env file. */
function configuredValue(key: string): string {
  const processValue = process.env[key]?.trim();
  if (processValue !== undefined && processValue.length > 0) {
    return processValue;
  }
  return (environmentFileValues()[key] ?? "").trim();
}

/** Forces the next read to re-open the .env, so edits apply without a restart. */
export function reloadConfiguration(): void {
  cachedEnvironmentFileValues = null;
}

// ------------------------------------------------------------------ API keys

export function geminiApiKey(): string {
  return settings().geminiApiKeyOverride || configuredValue("GEMINI_API_KEY");
}

/**
 * Optional Cloudflare Worker base URL. When set, Huddle proxies through it and
 * no local API key is needed. When empty, Huddle calls Gemini directly.
 */
export function workerBaseUrl(): string {
  return configuredValue("HUDDLE_WORKER_URL").replace(/\/+$/, "");
}

export function isUsingWorkerProxy(): boolean {
  return workerBaseUrl().length > 0;
}

/**
 * True when Huddle has what it needs to reach Gemini — either a Worker to
 * proxy through, or a local Gemini key. This gates the suggestion hotkey.
 */
export function isGeminiConfigured(): boolean {
  return isUsingWorkerProxy() || geminiApiKey().length > 0;
}

// ------------------------------------------------------------- suggestion model

export function modelIdentifier(): string {
  return (
    settings().modelIdentifierOverride ||
    configuredValue("HUDDLE_MODEL") ||
    DEFAULT_MODEL_IDENTIFIER
  );
}

// ----------------------------------------------------------------- endpoints

export function chatEndpointUrl(): string {
  return isUsingWorkerProxy()
    ? `${workerBaseUrl()}/chat?model=${encodeURIComponent(modelIdentifier())}`
    : `https://generativelanguage.googleapis.com/v1beta/models/${modelIdentifier()}:streamGenerateContent?alt=sse`;
}

/**
 * Auth headers for the chat request. Empty when proxying, because the Worker
 * holds the key and adds them on the way out.
 */
export function chatAuthHeaders(): Record<string, string> {
  if (isUsingWorkerProxy()) {
    return {};
  }
  return { "x-goog-api-key": geminiApiKey() };
}

// -------------------------------------------------------------- hotkey + timing

/** e.g. "Ctrl+Alt+H" — parsed by globalHotkey.ts into individual keys. */
export function suggestionHotkey(): string {
  return settings().hotkeyOverride || configuredValue("HUDDLE_HOTKEY") || DEFAULT_HOTKEY;
}

/** How much of the rolling transcript gets sent to Gemini per suggestion. */
export function contextWindowMinutes(): number {
  if (settings().contextWindowMinutesOverride !== undefined) {
    return settings().contextWindowMinutesOverride as number;
  }
  const parsed = Number(configuredValue("HUDDLE_CONTEXT_WINDOW_MINUTES"));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_CONTEXT_WINDOW_MINUTES;
}

/** How long transcript lines are kept in memory at all before being dropped. */
export function transcriptRetentionMinutes(): number {
  if (settings().transcriptRetentionMinutesOverride !== undefined) {
    return settings().transcriptRetentionMinutesOverride as number;
  }
  const parsed = Number(configuredValue("HUDDLE_TRANSCRIPT_RETENTION_MINUTES"));
  return Number.isFinite(parsed) && parsed > 0
    ? parsed
    : DEFAULT_TRANSCRIPT_RETENTION_MINUTES;
}

// ------------------------------------------------------------ persisted prefs

function settingsFilePath(): string {
  return path.join(app.getPath("userData"), "huddle-settings.json");
}

function settings(): PersistedSettings {
  if (cachedSettings === null) {
    try {
      const rawFileContents = fs.readFileSync(settingsFilePath(), "utf8");
      cachedSettings = { ...defaultSettings, ...(JSON.parse(rawFileContents) as Partial<PersistedSettings>) };
    } catch {
      // No settings file yet (first launch) or it's corrupt — use defaults.
      cachedSettings = { ...defaultSettings };
    }
  }
  return cachedSettings;
}

function persistSettingsToDisk(): void {
  try {
    fs.writeFileSync(settingsFilePath(), JSON.stringify(settings(), null, 2), "utf8");
  } catch (error) {
    console.error("Could not save settings:", error);
  }
}

export function isListeningEnabled(): boolean {
  return settings().isListeningEnabled;
}

export function setListeningEnabled(isEnabled: boolean): void {
  settings().isListeningEnabled = isEnabled;
  persistSettingsToDisk();
}

// ----------------------------------------------------------- settings window

/** The Settings window's starting values — whatever's currently in effect. */
export function currentSettingsSnapshot(): SettingsState {
  return {
    geminiApiKey: geminiApiKey(),
    hotkey: suggestionHotkey(),
    modelIdentifier: modelIdentifier(),
    contextWindowMinutes: contextWindowMinutes(),
    transcriptRetentionMinutes: transcriptRetentionMinutes(),
  };
}

/**
 * Applies and persists a full settings save in one go. Numbers are clamped
 * to something sane rather than rejected outright — a stray "0" or a typo
 * shouldn't brick the app, it should just fall back to a safe minimum.
 */
export function applySettingsUpdate(update: SettingsState): void {
  const current = settings();
  current.geminiApiKeyOverride = update.geminiApiKey.trim();
  current.hotkeyOverride = update.hotkey.trim();
  current.modelIdentifierOverride = update.modelIdentifier.trim();
  current.contextWindowMinutesOverride = Math.max(1, Math.round(update.contextWindowMinutes) || DEFAULT_CONTEXT_WINDOW_MINUTES);
  current.transcriptRetentionMinutesOverride = Math.max(
    current.contextWindowMinutesOverride,
    Math.round(update.transcriptRetentionMinutes) || DEFAULT_TRANSCRIPT_RETENTION_MINUTES
  );
  persistSettingsToDisk();
}
