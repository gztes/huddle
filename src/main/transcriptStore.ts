/**
 * The rolling in-memory transcript for the current call. Nothing here ever
 * touches disk — it exists only for the life of the process, which matches
 * Huddle's privacy story: nothing about a call outlives the call.
 */

import { transcriptRetentionMinutes } from "./config";
import type { TranscriptLine } from "../shared/types";

export class TranscriptStore {
  private lines: TranscriptLine[] = [];

  append(line: TranscriptLine): void {
    this.lines.push(line);
    this.trimToRetentionWindow();
  }

  /** All lines still within the retention window, oldest first. */
  recentLines(): TranscriptLine[] {
    this.trimToRetentionWindow();
    return this.lines;
  }

  /** Lines within the last `windowMinutes`, oldest first — for a suggestion request. */
  linesWithinMinutes(windowMinutes: number): TranscriptLine[] {
    const cutoffTimestampMs = Date.now() - windowMinutes * 60_000;
    return this.recentLines().filter((line) => line.timestampMs >= cutoffTimestampMs);
  }

  clear(): void {
    this.lines = [];
  }

  private trimToRetentionWindow(): void {
    const cutoffTimestampMs = Date.now() - transcriptRetentionMinutes() * 60_000;
    while (this.lines.length > 0 && this.lines[0].timestampMs < cutoffTimestampMs) {
      this.lines.shift();
    }
  }
}
