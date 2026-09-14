/**
 * Copies the renderer's HTML and CSS into dist/, next to the JavaScript that
 * tsc/esbuild emit there — same no-bundler approach as Clicky. Also copies the
 * Silero VAD model + worklet bundle (from @ricky0123/vad-web) and the
 * onnxruntime-web WASM runtime into dist/renderer/capture/vad-assets/, since
 * both are loaded at runtime by URL rather than bundled into capture.js.
 */

const fs = require("fs");
const path = require("path");

const projectRootDirectory = path.join(__dirname, "..");
const rendererSourceDirectory = path.join(projectRootDirectory, "src", "renderer");
const rendererOutputDirectory = path.join(projectRootDirectory, "dist", "renderer");

const STATIC_FILE_EXTENSIONS = [".html", ".css"];

function copyStaticFilesRecursively(sourceDirectory, outputDirectory) {
  fs.mkdirSync(outputDirectory, { recursive: true });

  for (const directoryEntry of fs.readdirSync(sourceDirectory, { withFileTypes: true })) {
    const sourcePath = path.join(sourceDirectory, directoryEntry.name);
    const outputPath = path.join(outputDirectory, directoryEntry.name);

    if (directoryEntry.isDirectory()) {
      copyStaticFilesRecursively(sourcePath, outputPath);
      continue;
    }

    if (STATIC_FILE_EXTENSIONS.includes(path.extname(directoryEntry.name))) {
      fs.copyFileSync(sourcePath, outputPath);
    }
  }
}

/** Copies every file directly inside sourceDirectory whose name matches one of `patterns`. */
function copyMatchingFiles(sourceDirectory, outputDirectory, patterns) {
  fs.mkdirSync(outputDirectory, { recursive: true });
  let copiedCount = 0;

  for (const fileName of fs.readdirSync(sourceDirectory)) {
    if (!patterns.some((pattern) => pattern.test(fileName))) {
      continue;
    }
    fs.copyFileSync(path.join(sourceDirectory, fileName), path.join(outputDirectory, fileName));
    copiedCount++;
  }

  return copiedCount;
}

copyStaticFilesRecursively(rendererSourceDirectory, rendererOutputDirectory);
console.log("Copied renderer HTML and CSS into dist/renderer");

const vadAssetsOutputDirectory = path.join(rendererOutputDirectory, "capture", "vad-assets");

// The VAD worklet bundle and the one model file we actually use ("v5").
const vadWebDistDirectory = path.join(
  projectRootDirectory,
  "node_modules",
  "@ricky0123",
  "vad-web",
  "dist"
);
const vadFileCount = copyMatchingFiles(vadWebDistDirectory, vadAssetsOutputDirectory, [
  /^vad\.worklet\.bundle\.min\.js$/,
  /^silero_vad_v5\.onnx$/,
]);

// onnxruntime-web's WASM runtime — filenames are version-specific, so copy
// every .wasm/.mjs file rather than naming them.
const onnxRuntimeDistDirectory = path.join(
  projectRootDirectory,
  "node_modules",
  "onnxruntime-web",
  "dist"
);
const onnxFileCount = copyMatchingFiles(onnxRuntimeDistDirectory, vadAssetsOutputDirectory, [
  /\.wasm$/,
  /\.mjs$/,
]);

console.log(
  `Copied ${vadFileCount} VAD asset(s) and ${onnxFileCount} onnxruntime-web runtime file(s) into dist/renderer/capture/vad-assets`
);
