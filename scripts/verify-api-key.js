/**
 * Verifies that Huddle's Gemini setup actually works, before you rely on it
 * live on a call. Run it with: npm run verify
 *
 * Sends a small fake transcript through the exact request shape
 * src/main/geminiClient.ts uses and checks that a streamed suggestion comes
 * back. Costs a fraction of a cent.
 */

const fs = require("fs");
const path = require("path");

const projectRootDirectory = path.join(__dirname, "..");

/** Reads GEMINI_API_KEY from the environment, falling back to .env. */
function resolveGeminiApiKey() {
  const environmentKey = process.env.GEMINI_API_KEY?.trim();
  if (environmentKey) {
    return { apiKey: environmentKey, source: "environment variable" };
  }

  const envFilePath = path.join(projectRootDirectory, ".env");
  let envFileContents;
  try {
    envFileContents = fs.readFileSync(envFilePath, "utf8");
  } catch {
    return { apiKey: "", source: `no .env found at ${envFilePath}` };
  }

  for (const rawLine of envFileContents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.startsWith("#") || !line.includes("=")) {
      continue;
    }
    const separatorIndex = line.indexOf("=");
    const key = line.slice(0, separatorIndex).trim();
    if (key !== "GEMINI_API_KEY") {
      continue;
    }
    const value = line.slice(separatorIndex + 1).trim().replace(/^["']|["']$/g, "");
    return { apiKey: value, source: ".env" };
  }

  return { apiKey: "", source: ".env (no GEMINI_API_KEY line)" };
}

const FAKE_TRANSCRIPT = [
  { channel: "them", text: "so honestly the pricing is a bit higher than we budgeted for this quarter." },
  { channel: "you", text: "I hear you — can you tell me more about what budget range you were expecting?" },
  { channel: "them", text: "we were thinking closer to half of what you quoted us." },
];

function formatTranscriptBlock(transcriptLines) {
  return transcriptLines
    .map((line) => `${line.channel === "you" ? "You" : "Them"}: ${line.text}`)
    .join("\n");
}

const SUGGESTION_SYSTEM_PROMPT = `you're huddle, a silent call companion. the user is live on a call right now and you're seeing a rolling transcript of both sides. your output appears on a small text overlay only the user can see.

rules:
- be extremely concise: 1-3 short bullet points, or a couple of short sentences.
- write suggestions, not scripts to read verbatim.
- ground your suggestion in the actual transcript.
- plain text only, a simple "-" for bullets is fine.`;

async function main() {
  const { apiKey, source } = resolveGeminiApiKey();

  if (!apiKey || apiKey === "...") {
    console.error(`✗ No usable GEMINI_API_KEY (looked in: ${source})`);
    console.error("  Put your key from aistudio.google.com/apikey in .env, then run this again.");
    process.exit(1);
  }

  console.log(`Key found via ${source} (${apiKey.slice(0, 6)}…${apiKey.slice(-4)})`);
  console.log("Sending a fake sales-call transcript…\n");

  const modelIdentifier = process.env.HUDDLE_MODEL || "gemini-2.5-flash";
  const promptText =
    `transcript so far:\n${formatTranscriptBlock(FAKE_TRANSCRIPT)}\n\n` +
    "the user didn't type a specific question — react to whatever was most recently said.";

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${modelIdentifier}:streamGenerateContent?alt=sse`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: SUGGESTION_SYSTEM_PROMPT }] },
        generation_config: {
          max_output_tokens: 256,
          thinking_config: { thinking_budget: modelIdentifier.includes("flash") ? 0 : 128 },
        },
        contents: [{ role: "user", parts: [{ text: promptText }] }],
      }),
    }
  );

  if (!response.ok) {
    const errorBody = await response.text();
    console.error(`✗ HTTP ${response.status}\n${errorBody}\n`);
    if (response.status === 400 && errorBody.includes("API key")) {
      console.error("  Check you copied the whole key from aistudio.google.com/apikey.");
    } else if (response.status === 429) {
      console.error("  Rate limited — the free tier has a low requests-per-minute cap. Wait and retry.");
    }
    process.exit(1);
  }

  // Read the SSE stream exactly the way src/main/geminiClient.ts does.
  const streamReader = response.body.getReader();
  const utf8Decoder = new TextDecoder();
  let undecodedBuffer = "";
  let accumulatedResponseText = "";
  let deltaCount = 0;

  while (true) {
    const { done, value } = await streamReader.read();
    if (done) break;

    undecodedBuffer += utf8Decoder.decode(value, { stream: true });
    const lines = undecodedBuffer.split("\n");
    undecodedBuffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmedLine = line.trim();
      if (!trimmedLine.startsWith("data: ")) continue;

      let eventPayload;
      try {
        eventPayload = JSON.parse(trimmedLine.slice(6));
      } catch {
        continue;
      }

      const parts = eventPayload.candidates?.[0]?.content?.parts ?? [];
      for (const part of parts) {
        if (typeof part.text === "string") {
          accumulatedResponseText += part.text;
          deltaCount++;
        }
      }
    }
  }

  console.log(`Suggestion:\n${accumulatedResponseText}\n`);

  console.log("✓ Key accepted");
  console.log(`✓ Streaming works (${deltaCount} deltas)`);

  if (accumulatedResponseText.trim().length === 0) {
    console.log("✗ Response was empty — check HUDDLE_MODEL and try again.");
    process.exit(1);
  }

  console.log("\nAll checks passed. Huddle is ready — npm start.");
}

main().catch((error) => {
  console.error("✗ Verification failed:", error.message);
  process.exit(1);
});
