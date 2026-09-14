/**
 * Dual-channel call capture: your mic, and system audio (the other side of
 * the call, via Windows WASAPI loopback) — each run through Silero VAD to
 * find speech segments, which are then transcribed locally with Whisper.
 *
 * Runs in a hidden window because getUserMedia, getDisplayMedia, AudioWorklet
 * and WebAssembly are all renderer-only APIs. See src/main/captureWindow.ts.
 */

import { pipeline, type AutomaticSpeechRecognitionPipeline } from "@huggingface/transformers";
import { MicVAD } from "@ricky0123/vad-web";

console.log("capture host: script starting");

/**
 * Which Whisper checkpoint to run — same choice Clicky makes, for the same
 * reason: `tiny.en` quantised to 8-bit is small and fast enough that a few
 * seconds of speech transcribes in well under a second on CPU.
 */
const WHISPER_MODEL_IDENTIFIER = "onnx-community/whisper-tiny.en";

/**
 * Where the Silero VAD model, its AudioWorklet bundle, and the onnxruntime-web
 * WASM binaries live, relative to this window's index.html. Populated by
 * scripts/copy-static.js from node_modules at build time.
 */
const VAD_ASSET_BASE_PATH = "./vad-assets/";

type SpeechChannel = "you" | "them";

/** The loaded Whisper pipeline, or the in-flight promise that is loading it. */
let speechRecognitionPipelinePromise: Promise<AutomaticSpeechRecognitionPipeline> | null = null;

let micStream: MediaStream | null = null;
let systemAudioStream: MediaStream | null = null;

// ----------------------------------------------------------- speech-to-text

/**
 * Loads Whisper, downloading the model on first call and reusing it after.
 * Kept as a single shared promise so overlapping speech segments wait on one
 * load instead of each starting their own.
 */
function loadSpeechRecognitionPipeline(): Promise<AutomaticSpeechRecognitionPipeline> {
  if (speechRecognitionPipelinePromise !== null) {
    return speechRecognitionPipelinePromise;
  }

  window.huddleCapture.reportModelsStatus({ state: "loading", progressPercent: 0 });

  speechRecognitionPipelinePromise = pipeline(
    "automatic-speech-recognition",
    WHISPER_MODEL_IDENTIFIER,
    {
      // See Clicky's audio.ts for why this is pinned to transformers.js v3 and
      // q8/wasm specifically — v4 fails to build a session for this dtype.
      dtype: "q8",
      device: "wasm",
      progress_callback: (progressEvent: { status?: string; progress?: number }) => {
        if (progressEvent.status === "progress" && typeof progressEvent.progress === "number") {
          window.huddleCapture.reportModelsStatus({
            state: "loading",
            progressPercent: Math.round(progressEvent.progress),
          });
        }
      },
    }
  )
    .then((loadedPipeline) => {
      window.huddleCapture.reportModelsStatus({ state: "ready", progressPercent: 100 });
      return loadedPipeline as AutomaticSpeechRecognitionPipeline;
    })
    .catch((loadError: unknown) => {
      speechRecognitionPipelinePromise = null;
      console.error(
        "speech model failed to load:",
        loadError instanceof Error ? `${loadError.message}\n${loadError.stack}` : String(loadError)
      );
      window.huddleCapture.reportModelsStatus({ state: "failed", progressPercent: 0 });
      throw loadError;
    });

  return speechRecognitionPipelinePromise;
}

/**
 * Trims Whisper's characteristic artefacts — bracketed stage directions like
 * "[BLANK_AUDIO]" or "(clears throat)" that would otherwise show up as lines
 * in the transcript. Identical to Clicky's cleanUpWhisperOutput.
 */
function cleanUpWhisperOutput(rawText: string): string {
  const withoutStageDirections = rawText
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/\([^)]*\)/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (/^[\s.,!?-]*$/.test(withoutStageDirections)) {
    return "";
  }

  return withoutStageDirections;
}

/** Called by a channel's VAD instance once it has a bounded speech segment. */
async function handleSpeechSegment(channel: SpeechChannel, audioSamples: Float32Array): Promise<void> {
  console.log(
    `[${channel}] speech segment ended (${(audioSamples.length / 16000).toFixed(1)}s), transcribing…`
  );
  try {
    const speechRecognitionPipeline = await loadSpeechRecognitionPipeline();
    const recognitionResult = await speechRecognitionPipeline(audioSamples);

    const recognisedText = Array.isArray(recognitionResult)
      ? recognitionResult.map((chunk) => chunk.text).join(" ")
      : recognitionResult.text;

    const cleanedText = cleanUpWhisperOutput(recognisedText);
    if (cleanedText.length === 0) {
      console.log(`[${channel}] segment discarded (${audioSamples.length} samples, no speech text)`);
      return;
    }

    console.log(`[${channel}] "${cleanedText}"`);
    window.huddleCapture.reportTranscriptSegment({
      channel,
      text: cleanedText,
      timestampMs: Date.now(),
    });
  } catch (transcriptionError) {
    console.error(`[${channel}] transcription failed:`, transcriptionError);
  }
}

// --------------------------------------------------------------------- VAD

/**
 * VAD's redemptionMs only ends a segment on a quiet gap — continuous sound
 * (someone talking for a long stretch, or steady background noise on the
 * system-audio channel) would otherwise grow one segment forever. Confirmed
 * live: without this cap, a noisy test run fed Whisper a 30+ second clip.
 * This force-flushes via `submitUserSpeechOnPause`, which makes `.pause()`
 * emit `onSpeechEnd` for whatever's buffered so far, then immediately resumes.
 */
const MAX_SEGMENT_DURATION_MS = 20_000;

/**
 * Starts VAD on a channel's stream. `MicVAD` acquires its stream through the
 * `getStream` callback rather than always calling getUserMedia itself, so it
 * works equally well pointed at the system-audio loopback stream — nothing
 * about the class is actually mic-specific once you supply your own stream.
 */
async function startVadChannel(channel: SpeechChannel, stream: MediaStream): Promise<void> {
  let vadInstance: MicVAD | null = null;
  let segmentWatchdogTimer: ReturnType<typeof setTimeout> | null = null;

  const clearSegmentWatchdog = (): void => {
    if (segmentWatchdogTimer !== null) {
      clearTimeout(segmentWatchdogTimer);
      segmentWatchdogTimer = null;
    }
  };

  vadInstance = await MicVAD.new({
    model: "v5",
    baseAssetPath: VAD_ASSET_BASE_PATH,
    onnxWASMBasePath: VAD_ASSET_BASE_PATH,
    submitUserSpeechOnPause: true,
    getStream: async () => stream,
    // We never call .pause()/.start() to mute — that's done by disabling the
    // underlying MediaStreamTrack instead (see onSetListeningEnabled below).
    // pause()/start() ARE used, deliberately, by the segment watchdog above.
    pauseStream: async () => {},
    resumeStream: async () => stream,
    ortConfig: (ort) => {
      ort.env.logLevel = "error";
      // Threaded WASM needs cross-origin isolation headers this file://
      // renderer doesn't have; force single-threaded so it doesn't silently
      // misbehave.
      ort.env.wasm.numThreads = 1;
    },
    onSpeechStart: () => {
      clearSegmentWatchdog();
      segmentWatchdogTimer = setTimeout(() => {
        void vadInstance?.pause().then(() => vadInstance?.start());
      }, MAX_SEGMENT_DURATION_MS);
    },
    onSpeechEnd: (audioSamples: Float32Array) => {
      clearSegmentWatchdog();
      void handleSpeechSegment(channel, audioSamples);
    },
    onVADMisfire: () => {
      clearSegmentWatchdog();
    },
  });

  console.log(`capture host: VAD listening on "${channel}" channel`);
}

async function startMicChannel(): Promise<void> {
  try {
    micStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    window.huddleCapture.reportMicrophonePermission(true);
    await startVadChannel("you", micStream);
  } catch (captureError) {
    const errorMessage = captureError instanceof Error ? captureError.message : String(captureError);
    window.huddleCapture.reportMicrophonePermission(false);
    window.huddleCapture.reportCaptureFailed("microphone", errorMessage);
  }
}

async function startSystemAudioChannel(): Promise<void> {
  try {
    // video: false matches the main process's setDisplayMediaRequestHandler,
    // which answers with { audio: 'loopback' } and no video source — asking
    // for video here and not getting one back throws "Video was requested,
    // but no video stream was provided".
    const displayStream = await navigator.mediaDevices.getDisplayMedia({
      audio: true,
      video: false,
    });

    systemAudioStream = displayStream;
    await startVadChannel("them", systemAudioStream);
  } catch (captureError) {
    const errorMessage = captureError instanceof Error ? captureError.message : String(captureError);
    window.huddleCapture.reportCaptureFailed("system-audio", errorMessage);
  }
}

// ------------------------------------------------------------- permissions

async function probeMicrophonePermission(): Promise<void> {
  if (micStream !== null) {
    window.huddleCapture.reportMicrophonePermission(true);
    return;
  }
  try {
    const probeStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    for (const mediaTrack of probeStream.getTracks()) {
      mediaTrack.stop();
    }
    window.huddleCapture.reportMicrophonePermission(true);
  } catch {
    window.huddleCapture.reportMicrophonePermission(false);
  }
}

// -------------------------------------------------------------- listening

function setListeningEnabled(isEnabled: boolean): void {
  for (const stream of [micStream, systemAudioStream]) {
    if (stream === null) {
      continue;
    }
    for (const track of stream.getTracks()) {
      track.enabled = isEnabled;
    }
  }
}

// ------------------------------------------------------------- wire up IPC

window.huddleCapture.onProbeMicrophonePermission(() => {
  void probeMicrophonePermission();
});

window.huddleCapture.onSetListeningEnabled((isEnabled) => {
  setListeningEnabled(isEnabled);
});

// Both channels and the Whisper download start immediately and run for the
// whole lifetime of the app — there is no explicit "start capture" trigger
// the way Clicky has for push-to-talk.
void loadSpeechRecognitionPipeline().catch(() => {
  // Already reported through reportModelsStatus; nothing to add here.
});
void startMicChannel();
void startSystemAudioChannel();

console.log("capture host: ready");
