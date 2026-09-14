/**
 * The History window's UI logic — a simple two-state (list / detail)
 * master-detail view over the sessions main process reads from disk.
 */

// See the matching comment in overlay.ts for why this is an IIFE: every
// renderer/*.ts file compiles together as one non-module TS project, so
// same-named top-level consts across files (this one, settings.ts, etc.)
// would otherwise collide during type-checking.
(function (): void {
  const backButton = document.getElementById("back-button") as HTMLButtonElement;
  const closeButton = document.getElementById("close-button") as HTMLButtonElement;
  const sessionListViewElement = document.getElementById("session-list-view") as HTMLElement;
  const sessionDetailViewElement = document.getElementById("session-detail-view") as HTMLElement;
  const emptyStateElement = document.getElementById("empty-state") as HTMLParagraphElement;
  const sessionListElement = document.getElementById("session-list") as HTMLDivElement;
  const detailEventTitleElement = document.getElementById("detail-event-title") as HTMLHeadingElement;
  const detailDateElement = document.getElementById("detail-date") as HTMLParagraphElement;
  const detailSummarySectionElement = document.getElementById("detail-summary-section") as HTMLElement;
  const detailSummaryTextElement = document.getElementById("detail-summary-text") as HTMLParagraphElement;
  const detailTranscriptElement = document.getElementById("detail-transcript") as HTMLDivElement;
  const deleteSessionButton = document.getElementById("delete-session-button") as HTMLButtonElement;
  const deleteAllButton = document.getElementById("delete-all-button") as HTMLButtonElement;

  let currentDetailSessionId: string | null = null;

  function formatSessionDate(startedAtMs: number): string {
    return new Date(startedAtMs).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  }

  async function loadAndRenderSessionList(): Promise<void> {
    const sessions = await window.huddleHistory.requestSessions();

    emptyStateElement.classList.toggle("is-hidden", sessions.length > 0);
    sessionListElement.replaceChildren(
      ...sessions.map((session) => {
        const rowButton = document.createElement("button");
        rowButton.type = "button";
        rowButton.className = "session-row";

        const dateElement = document.createElement("span");
        dateElement.className = "session-date";
        dateElement.textContent = formatSessionDate(session.startedAtMs);

        const previewElement = document.createElement("span");
        previewElement.className = "session-preview";
        if (session.calendarEventTitle !== null) {
          // The calendar event title is the row's primary label when present —
          // the timestamp above it becomes the secondary detail instead.
          previewElement.textContent = session.calendarEventTitle;
        } else {
          // A real summary reads as a title; a raw first-transcript-line fallback
          // reads as a quote, so it gets a visual cue to tell them apart.
          previewElement.textContent = session.hasSummary
            ? session.previewText
            : `"${session.previewText}"`;
        }

        const metaElement = document.createElement("span");
        metaElement.className = "session-meta";
        metaElement.textContent = `${session.lineCount} line${session.lineCount === 1 ? "" : "s"}`;

        rowButton.append(dateElement, previewElement, metaElement);
        rowButton.addEventListener("click", () => void showSessionDetail(session.sessionId));
        return rowButton;
      })
    );
  }

  async function showSessionDetail(sessionId: string): Promise<void> {
    const session = await window.huddleHistory.requestSessionDetail(sessionId);
    if (session === null) {
      // Deleted from under us, or a read error — just go back to the list.
      await loadAndRenderSessionList();
      return;
    }

    currentDetailSessionId = sessionId;
    // Older session files predate this field entirely (undefined at runtime
    // despite the string | null type) — normalize to null rather than `!== null`.
    const calendarEventTitle = session.calendarEventTitle ?? null;
    detailEventTitleElement.classList.toggle("is-hidden", calendarEventTitle === null);
    detailEventTitleElement.textContent = calendarEventTitle ?? "";
    detailDateElement.textContent = formatSessionDate(session.startedAtMs);

    detailSummarySectionElement.classList.toggle("is-hidden", session.summary === null);
    detailSummaryTextElement.textContent = session.summary ?? "";

    detailTranscriptElement.replaceChildren(
      ...session.lines.map((line) => {
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

    sessionListViewElement.classList.add("is-hidden");
    sessionDetailViewElement.classList.remove("is-hidden");
    backButton.classList.remove("is-hidden");
    deleteSessionButton.classList.remove("is-hidden");
  }

  function showSessionList(): void {
    currentDetailSessionId = null;
    sessionDetailViewElement.classList.add("is-hidden");
    sessionListViewElement.classList.remove("is-hidden");
    backButton.classList.add("is-hidden");
    deleteSessionButton.classList.add("is-hidden");
    void loadAndRenderSessionList();
  }

  backButton.addEventListener("click", showSessionList);
  closeButton.addEventListener("click", () => window.huddleHistory.requestClose());

  deleteSessionButton.addEventListener("click", () => {
    if (currentDetailSessionId === null) {
      return;
    }
    if (!confirm("Delete this session? This can't be undone.")) {
      return;
    }
    window.huddleHistory.deleteSession(currentDetailSessionId);
    showSessionList();
  });

  deleteAllButton.addEventListener("click", () => {
    if (!confirm("Delete all history? This can't be undone.")) {
      return;
    }
    window.huddleHistory.deleteAllSessions();
    void loadAndRenderSessionList();
  });

  // -------------------------------------------------------------------- boot

  void loadAndRenderSessionList();
})();
