/**
 * Draws the tray icon (a solid amber dot, distinct from Clicky's blue arrow)
 * and writes it as a PNG. Same hand-rolled PNG encoder as Clicky's — the icon
 * is one flat shape, so it isn't worth pulling in an image library for it.
 */

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const ICON_SIZE_PIXELS = 32;

/** The "Them" accent from overlay.css, #FFB264, plus a white outline. */
const DOT_AMBER = [0xff, 0xb2, 0x64];
const OUTLINE_WHITE = [0xff, 0xff, 0xff];

const CIRCLE_CENTER_NORMALIZED = 0.5;
const CIRCLE_RADIUS_NORMALIZED = 0.32;
const OUTLINE_RADIUS_NORMALIZED = 0.38;

/** Builds raw RGBA pixels for the icon, anti-aliased by 3x3 supersampling. */
function renderIconPixels() {
  // One extra byte per row for the PNG filter type.
  const rawImageData = Buffer.alloc(ICON_SIZE_PIXELS * (ICON_SIZE_PIXELS * 4 + 1));
  const SUPERSAMPLE_STEPS = 3;
  const centerPixels = CIRCLE_CENTER_NORMALIZED * ICON_SIZE_PIXELS;
  const fillRadiusPixels = CIRCLE_RADIUS_NORMALIZED * ICON_SIZE_PIXELS;
  const outlineRadiusPixels = OUTLINE_RADIUS_NORMALIZED * ICON_SIZE_PIXELS;

  for (let pixelY = 0; pixelY < ICON_SIZE_PIXELS; pixelY++) {
    const rowStartOffset = pixelY * (ICON_SIZE_PIXELS * 4 + 1);
    rawImageData[rowStartOffset] = 0; // filter type: none

    for (let pixelX = 0; pixelX < ICON_SIZE_PIXELS; pixelX++) {
      let fillSampleCount = 0;
      let outlineSampleCount = 0;

      for (let subY = 0; subY < SUPERSAMPLE_STEPS; subY++) {
        for (let subX = 0; subX < SUPERSAMPLE_STEPS; subX++) {
          const sampleX = pixelX + (subX + 0.5) / SUPERSAMPLE_STEPS;
          const sampleY = pixelY + (subY + 0.5) / SUPERSAMPLE_STEPS;
          const distanceFromCenter = Math.hypot(sampleX - centerPixels, sampleY - centerPixels);

          if (distanceFromCenter <= fillRadiusPixels) {
            fillSampleCount++;
          } else if (distanceFromCenter <= outlineRadiusPixels) {
            outlineSampleCount++;
          }
        }
      }

      const totalSampleCount = SUPERSAMPLE_STEPS * SUPERSAMPLE_STEPS;
      const fillCoverage = fillSampleCount / totalSampleCount;
      const outlineCoverage = outlineSampleCount / totalSampleCount;

      const [red, green, blue] = fillCoverage > 0 ? DOT_AMBER : OUTLINE_WHITE;
      const alpha = Math.round(Math.min(1, fillCoverage + outlineCoverage) * 255);

      const pixelOffset = rowStartOffset + 1 + pixelX * 4;
      rawImageData[pixelOffset] = red;
      rawImageData[pixelOffset + 1] = green;
      rawImageData[pixelOffset + 2] = blue;
      rawImageData[pixelOffset + 3] = alpha;
    }
  }

  return rawImageData;
}

/** Wraps a chunk's data with its length, type and CRC, per the PNG spec. */
function buildPngChunk(chunkType, chunkData) {
  const lengthBuffer = Buffer.alloc(4);
  lengthBuffer.writeUInt32BE(chunkData.length, 0);

  const typeAndDataBuffer = Buffer.concat([Buffer.from(chunkType, "ascii"), chunkData]);

  const crcBuffer = Buffer.alloc(4);
  crcBuffer.writeUInt32BE(computeCrc32(typeAndDataBuffer), 0);

  return Buffer.concat([lengthBuffer, typeAndDataBuffer, crcBuffer]);
}

const CRC32_TABLE = (() => {
  const table = new Int32Array(256);
  for (let tableIndex = 0; tableIndex < 256; tableIndex++) {
    let crcValue = tableIndex;
    for (let bitIndex = 0; bitIndex < 8; bitIndex++) {
      crcValue = crcValue & 1 ? 0xedb88320 ^ (crcValue >>> 1) : crcValue >>> 1;
    }
    table[tableIndex] = crcValue;
  }
  return table;
})();

function computeCrc32(inputBuffer) {
  let crcValue = -1;
  for (const inputByte of inputBuffer) {
    crcValue = CRC32_TABLE[(crcValue ^ inputByte) & 0xff] ^ (crcValue >>> 8);
  }
  return (crcValue ^ -1) >>> 0;
}

function encodePng(rawImageData) {
  const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const headerData = Buffer.alloc(13);
  headerData.writeUInt32BE(ICON_SIZE_PIXELS, 0);
  headerData.writeUInt32BE(ICON_SIZE_PIXELS, 4);
  headerData[8] = 8; // bit depth
  headerData[9] = 6; // colour type: RGBA
  headerData[10] = 0; // compression: deflate
  headerData[11] = 0; // filter: adaptive
  headerData[12] = 0; // interlace: none

  return Buffer.concat([
    PNG_SIGNATURE,
    buildPngChunk("IHDR", headerData),
    buildPngChunk("IDAT", zlib.deflateSync(rawImageData)),
    buildPngChunk("IEND", Buffer.alloc(0)),
  ]);
}

const assetsDirectory = path.join(__dirname, "..", "assets");
fs.mkdirSync(assetsDirectory, { recursive: true });

const trayIconOutputPath = path.join(assetsDirectory, "trayIcon.png");
fs.writeFileSync(trayIconOutputPath, encodePng(renderIconPixels()));

console.log(`Wrote ${trayIconOutputPath} (${ICON_SIZE_PIXELS}x${ICON_SIZE_PIXELS})`);
