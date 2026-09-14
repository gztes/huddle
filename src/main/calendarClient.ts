/**
 * Read-only Google Calendar access via a per-calendar ICS feed URL — no
 * OAuth. See docs/superpowers/specs/2026-09-14-calendar-integration-design.md
 * for why ICS was chosen over OAuth for this scope.
 *
 * Recurring events (RRULE) are expanded with node-ical rather than
 * hand-rolled, unlike config.ts's trivial `.env` parser — recurrence rules
 * are genuinely easy to get subtly wrong, and a "Weekly Sync"-style
 * recurring meeting is the primary use case this feature exists for.
 */

import * as ical from "node-ical";
import { calendarIcsUrl } from "./config";
import type { ParameterValue } from "node-ical";

export interface CalendarEvent {
  title: string;
  startMs: number;
  endMs: number;
}

/** How far around "now" to expand recurring events on each refresh. */
const LOOKBEHIND_DAYS = 1;
const LOOKAHEAD_DAYS = 30;

export class CalendarClient {
  private events: CalendarEvent[] = [];

  /** Re-fetches and re-parses the configured ICS feed. No-ops if no URL is configured. */
  async refresh(): Promise<void> {
    const icsUrl = calendarIcsUrl();
    if (icsUrl.length === 0) {
      return;
    }

    try {
      const parsedCalendar = await ical.async.fromURL(icsUrl);
      this.events = expandCalendarEvents(parsedCalendar);
    } catch (error) {
      // Bad URL, network hiccup, revoked secret link — keep the last-known-good
      // events rather than clearing them. No user-facing error surface for v1.
      console.error("Could not refresh calendar feed:", error);
    }
  }

  /** The event covering this instant, if any. */
  eventContaining(timestampMs: number): CalendarEvent | null {
    return (
      this.events.find((event) => event.startMs <= timestampMs && timestampMs < event.endMs) ?? null
    );
  }

  /** The soonest upcoming event starting after this instant, if any. */
  nextEvent(fromMs: number): CalendarEvent | null {
    let soonest: CalendarEvent | null = null;
    for (const event of this.events) {
      if (event.startMs > fromMs && (soonest === null || event.startMs < soonest.startMs)) {
        soonest = event;
      }
    }
    return soonest;
  }
}

function expandCalendarEvents(parsedCalendar: ical.CalendarResponse): CalendarEvent[] {
  const now = Date.now();
  const rangeStart = new Date(now - LOOKBEHIND_DAYS * 24 * 60 * 60 * 1000);
  const rangeEnd = new Date(now + LOOKAHEAD_DAYS * 24 * 60 * 60 * 1000);

  const events: CalendarEvent[] = [];
  for (const component of Object.values(parsedCalendar)) {
    if (component === undefined || component.type !== "VEVENT") {
      continue;
    }

    if (component.rrule) {
      for (const instance of ical.expandRecurringEvent(component, { from: rangeStart, to: rangeEnd })) {
        events.push({
          title: resolveEventTitle(instance.summary),
          startMs: instance.start.getTime(),
          endMs: instance.end.getTime(),
        });
      }
    } else if (component.start !== undefined) {
      events.push({
        title: resolveEventTitle(component.summary),
        startMs: component.start.getTime(),
        // A handful of real-world ICS entries omit DTEND; treat those as instants.
        endMs: (component.end ?? component.start).getTime(),
      });
    }
  }

  return events;
}

/** SUMMARY comes back as a plain string, or `{val, params}` when it carries iCal parameters. */
function resolveEventTitle(summary: ParameterValue): string {
  return typeof summary === "string" ? summary : summary.val;
}
