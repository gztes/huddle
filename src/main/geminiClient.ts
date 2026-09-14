/**
 * Gemini text client with SSE streaming, talking to the Cloudflare Worker's
 * /chat route (or Google's API directly). Adapted from Clicky's geminiClient.ts,
 * but text-only — the transcript already comes from local Whisper, so there's
 * no image or audio payload here, just plain text in and text out.
 */

import { chatAuthHeaders, chatEndpointUrl, modelIdentifier } from "./config";
import type { TranscriptLine } from "../shared/types";

/**
 * The suggestion system prompt. Huddle is a silent, read-only HUD: the user
 * reads the suggestion and says it in their own words, so it must be short
 * and scannable, never something to be read aloud verbatim.
 */
export const SUGGESTION_SYSTEM_PROMPT = `you're huddle, a silent call companion. the user is live on a call right now — a sales call, a meeting, an interview — and you're seeing a rolling transcript of both sides. your output appears on a small text overlay only the user can see; it is never spoken and the other person never sees it.

rules:
- be extremely concise. 1-3 short bullet points, or a couple of short sentences. the user has maybe 3-5 seconds to glance at this before responding out loud.
- write suggestions, not scripts to read verbatim — natural phrases the user can say in their own words, not a monologue.
- ground your suggestion in the actual transcript: reference what was specifically said, not generic advice.
- if the user asked a specific question (given below), answer that directly instead of just reacting to the transcript.
- if the transcript doesn't give you enough to say anything useful yet, say so briefly rather than inventing advice.
- plain text only. no markdown headers, no bold, a simple "-" for bullets is fine.
- never break character or mention that you are an AI, a prompt, or a tool — the output is only ever the suggestion itself.
- if you have live search results available, pull out only the 1-3 facts that actually matter right now — no source lists, no "according to".

the transcript below is labeled "You:" for the user's own speech and "Them:" for the other party, in chronological order.`;

/** One prior suggestion round, kept only so a follow-up question has context. */
export interface SuggestionExchange {
  userQuestion: string;
  suggestionText: string;
}

function formatTranscriptBlock(transcriptLines: TranscriptLine[]): string {
  if (transcriptLines.length === 0) {
    return "(no transcript yet)";
  }
  return transcriptLines
    .map((line) => `${line.channel === "you" ? "You" : "Them"}: ${line.text}`)
    .join("\n");
}

/**
 * Sends the rolling transcript plus an optional typed question to Gemini and
 * streams the suggestion back. `onTextChunk` receives the accumulated text so
 * far each time a new delta arrives.
 *
 * `abortSignal` lets the caller cancel an in-flight suggestion when the user
 * dismisses the overlay or asks a new question before this one finishes.
 */
export async function requestStreamingSuggestion(options: {
  transcriptLines: TranscriptLine[];
  typedQuestion: string;
  priorExchanges: SuggestionExchange[];
  /** Turns on Gemini's Google Search grounding tool — used by the "Search the web" Quick Action. */
  enableWebSearch: boolean;
  abortSignal: AbortSignal;
  onTextChunk: (accumulatedText: string) => void;
}): Promise<string> {
  const contents: unknown[] = [];

  for (const exchange of options.priorExchanges) {
    contents.push({
      role: "user",
      parts: [{ text: exchange.userQuestion || "(react to the recent conversation)" }],
    });
    contents.push({ role: "model", parts: [{ text: exchange.suggestionText }] });
  }

  const trimmedQuestion = options.typedQuestion.trim();
  const promptText =
    `transcript so far:\n${formatTranscriptBlock(options.transcriptLines)}\n\n` +
    (trimmedQuestion.length > 0
      ? `the user is specifically asking: ${trimmedQuestion}`
      : "the user didn't type a specific question — react to whatever was most recently said.");

  contents.push({ role: "user", parts: [{ text: promptText }] });

  const requestBody = {
    system_instruction: { parts: [{ text: SUGGESTION_SYSTEM_PROMPT }] },
    generation_config: {
      max_output_tokens: 512,
      thinking_config: thinkingConfigForModel(modelIdentifier()),
    },
    ...(options.enableWebSearch ? { tools: [{ google_search: {} }] } : {}),
    contents,
  };

  const response = await fetch(chatEndpointUrl(), {
    method: "POST",
    // In local mode these carry the Gemini key; when proxying through
    // the Worker they are empty and the Worker adds its own.
    headers: { "content-type": "application/json", ...chatAuthHeaders() },
    body: JSON.stringify(requestBody),
    signal: options.abortSignal,
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Gemini request failed (HTTP ${response.status}): ${errorBody}`);
  }

  if (response.body === null) {
    throw new Error("Gemini response had no body to stream.");
  }

  return await readServerSentEventTextStream(response.body, options.onTextChunk);
}

/**
 * Thinking is on by default on 2.5 models and eats into max_output_tokens
 * before any visible text comes out — bad when the user needs an answer in
 * the next few seconds of a live call. Flash can disable it outright; Pro's
 * API rejects a budget of 0 (minimum is 128), so it gets the smallest budget
 * it accepts instead.
 */
function thinkingConfigForModel(modelId: string): { thinking_budget: number } {
  return { thinking_budget: modelId.includes("flash") ? 0 : 128 };
}

/**
 * Reads a Gemini `streamGenerateContent` SSE stream and accumulates the text
 * parts of each candidate as they arrive.
 *
 * SSE frames arrive as `data: {json}\n\n`, but chunk boundaries fall wherever
 * the network puts them — so we buffer and only process complete lines.
 */
async function readServerSentEventTextStream(
  responseBody: ReadableStream<Uint8Array>,
  onTextChunk: (accumulatedText: string) => void
): Promise<string> {
  const streamReader = responseBody.getReader();
  const utf8Decoder = new TextDecoder();

  let undecodedBuffer = "";
  let accumulatedResponseText = "";

  while (true) {
    const { done, value } = await streamReader.read();
    if (done) {
      break;
    }

    undecodedBuffer += utf8Decoder.decode(value, { stream: true });

    const lines = undecodedBuffer.split("\n");
    undecodedBuffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmedLine = line.trim();
      if (!trimmedLine.startsWith("data: ")) {
        continue;
      }

      const jsonPayload = trimmedLine.slice("data: ".length);

      let eventPayload: { candidates?: { content?: { parts?: { text?: string }[] } }[] };
      try {
        eventPayload = JSON.parse(jsonPayload);
      } catch {
        continue;
      }

      const parts = eventPayload.candidates?.[0]?.content?.parts ?? [];
      for (const part of parts) {
        if (typeof part.text === "string") {
          accumulatedResponseText += part.text;
          onTextChunk(accumulatedResponseText);
        }
      }
    }
  }

  return accumulatedResponseText;
}
